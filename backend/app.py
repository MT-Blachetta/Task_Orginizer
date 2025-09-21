import json
import logging
import os
import sqlite3
import uuid
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, List
from urllib.parse import urlsplit

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, 'database.sqlite')

logging.basicConfig(level=logging.INFO, format='[%(asctime)s] %(levelname)s: %(message)s')

SCHEMA = [
    'PRAGMA foreign_keys = ON',
    '''CREATE TABLE IF NOT EXISTS categories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        position INTEGER NOT NULL
    )''',
    '''CREATE TABLE IF NOT EXISTS groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        start TEXT NOT NULL,
        duration_days INTEGER NOT NULL,
        duration_hours INTEGER NOT NULL,
        duration_minutes INTEGER NOT NULL,
        next INTEGER,
        position INTEGER NOT NULL
    )''',
    '''CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        done INTEGER NOT NULL DEFAULT 0,
        is_expanded INTEGER,
        parent_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
        category_id TEXT REFERENCES categories(id) ON DELETE CASCADE,
        group_id TEXT REFERENCES groups(id) ON DELETE CASCADE,
        position INTEGER NOT NULL
    )'''
]


def open_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys = ON')
    return conn


def initialise_db() -> None:
    with open_db() as conn:
        cur = conn.cursor()
        for statement in SCHEMA:
            cur.execute(statement)
        conn.commit()


def generate_id() -> str:
    return uuid.uuid4().hex


def insert_tasks(cur: sqlite3.Cursor, tasks: List[Dict[str, Any]], owner_type: str, owner_id: str, parent_id: str | None) -> None:
    if not isinstance(tasks, list):
        return
    for index, raw_task in enumerate(tasks):
        if not isinstance(raw_task, dict):
            continue
        task_id = raw_task.get('id') or generate_id()
        text = str(raw_task.get('text') or '').strip()
        if not text:
            continue
        subtasks = raw_task.get('subtasks')
        if not isinstance(subtasks, list):
            subtasks = []
        done = 1 if raw_task.get('done') else 0
        is_expanded_value = raw_task.get('isExpanded')
        if is_expanded_value is None:
            is_expanded_value = 1 if subtasks else 0
        else:
            is_expanded_value = 1 if is_expanded_value else 0
        category_id = owner_id if owner_type == 'category' and parent_id is None else None
        group_id = owner_id if owner_type == 'group' and parent_id is None else None
        cur.execute(
            'INSERT INTO tasks (id, text, done, is_expanded, parent_id, category_id, group_id, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            (task_id, text, done, is_expanded_value, parent_id, category_id, group_id, index)
        )
        if subtasks:
            insert_tasks(cur, subtasks, 'task', task_id, task_id)


def replace_data(payload: Dict[str, Any]) -> Dict[str, Any]:
    categories = payload.get('standard')
    groups = payload.get('groups')
    if not isinstance(categories, list) or not isinstance(groups, list):
        raise ValueError('Payload must provide "standard" and "groups" arrays')

    with open_db() as conn:
        cur = conn.cursor()
        try:
            cur.execute('BEGIN IMMEDIATE')
            cur.execute('DELETE FROM tasks')
            cur.execute('DELETE FROM categories')
            cur.execute('DELETE FROM groups')

            for index, category in enumerate(categories):
                if not isinstance(category, dict):
                    continue
                category_id = category.get('id') or generate_id()
                name = str(category.get('name') or '').strip() or 'Category'
                cur.execute(
                    'INSERT INTO categories (id, name, position) VALUES (?, ?, ?)',
                    (category_id, name, index)
                )
                insert_tasks(cur, category.get('tasks') or [], 'category', category_id, None)

            for index, group in enumerate(groups):
                if not isinstance(group, dict):
                    continue
                group_id = group.get('id') or generate_id()
                name = str(group.get('name') or '').strip() or 'Group'
                duration = group.get('duration') or {}
                duration_days = int(duration.get('days') or 0)
                duration_hours = int(duration.get('hours') or 0)
                duration_minutes = int(duration.get('minutes') or 0)
                start = str(group.get('start') or '')
                next_value = group.get('next')
                next_number = int(next_value) if next_value is not None else None
                cur.execute(
                    'INSERT INTO groups (id, name, start, duration_days, duration_hours, duration_minutes, next, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                    (group_id, name, start, duration_days, duration_hours, duration_minutes, next_number, index)
                )
                insert_tasks(cur, group.get('tasks') or [], 'group', group_id, None)

            conn.commit()
        except Exception:
            conn.rollback()
            raise

    return fetch_data()


def build_task_tree(rows: List[sqlite3.Row]):
    children: Dict[str, List[sqlite3.Row]] = {}
    for row in rows:
        if row['parent_id']:
            key = row['parent_id']
        elif row['category_id']:
            key = f'category:{row["category_id"]}'
        elif row['group_id']:
            key = f'group:{row["group_id"]}'
        else:
            key = 'orphan'
        children.setdefault(key, []).append(row)

    for row_list in children.values():
        row_list.sort(key=lambda item: item['position'])

    def build_for_key(key: str) -> List[Dict[str, Any]]:
        items = children.get(key, [])
        tasks_output: List[Dict[str, Any]] = []
        for item in items:
            task: Dict[str, Any] = {
                'id': item['id'],
                'text': item['text'],
                'done': bool(item['done']),
                'subtasks': build_for_key(item['id'])
            }
            if item['is_expanded'] is not None:
                task['isExpanded'] = bool(item['is_expanded'])
            tasks_output.append(task)
        return tasks_output

    return build_for_key


def fetch_data() -> Dict[str, Any]:
    with open_db() as conn:
        cur = conn.cursor()
        categories = cur.execute('SELECT id, name, position FROM categories ORDER BY position ASC').fetchall()
        groups = cur.execute('SELECT id, name, start, duration_days, duration_hours, duration_minutes, next, position FROM groups ORDER BY position ASC').fetchall()
        tasks = cur.execute('SELECT id, text, done, is_expanded, parent_id, category_id, group_id, position FROM tasks ORDER BY position ASC').fetchall()

    tree_builder = build_task_tree(tasks)

    standard = [
        {
            'id': category['id'],
            'name': category['name'],
            'tasks': tree_builder(f'category:{category["id"]}')
        }
        for category in categories
    ]

    group_list = [
        {
            'id': group['id'],
            'name': group['name'],
            'start': group['start'],
            'duration': {
                'days': int(group['duration_days'] or 0),
                'hours': int(group['duration_hours'] or 0),
                'minutes': int(group['duration_minutes'] or 0)
            },
            'next': int(group['next']) if group['next'] is not None else None,
            'tasks': tree_builder(f'group:{group["id"]}')
        }
        for group in groups
    ]

    return {'standard': standard, 'groups': group_list}


def clear_data() -> None:
    with open_db() as conn:
        cur = conn.cursor()
        cur.execute('BEGIN IMMEDIATE')
        cur.execute('DELETE FROM tasks')
        cur.execute('DELETE FROM categories')
        cur.execute('DELETE FROM groups')
        conn.commit()


class TaskOrganizerHandler(BaseHTTPRequestHandler):
    server_version = 'TaskOrganizerBackend/1.0'

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A003 - matching BaseHTTPRequestHandler signature
        logging.info("%s - %s", self.address_string(), format % args)

    def send_cors_headers(self) -> None:
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET,PUT,DELETE,OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def do_OPTIONS(self) -> None:  # noqa: N802 - required name
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_cors_headers()
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802 - required name
        parsed_path = urlsplit(self.path).path
        try:
            if parsed_path == '/health':
                self._write_json(HTTPStatus.OK, {'status': 'ok'})
            elif parsed_path == '/data':
                payload = fetch_data()
                self._write_json(HTTPStatus.OK, payload)
            else:
                self._write_json(HTTPStatus.NOT_FOUND, {'error': 'Not found'})
        except Exception as exc:  # pylint: disable=broad-except
            logging.exception('Failed to handle GET %s', parsed_path)
            self._write_json(HTTPStatus.INTERNAL_SERVER_ERROR, {'error': 'Internal server error', 'details': str(exc)})

    def do_PUT(self) -> None:  # noqa: N802 - required name
        parsed_path = urlsplit(self.path).path
        if parsed_path != '/data':
            self._write_json(HTTPStatus.NOT_FOUND, {'error': 'Not found'})
            return

        try:
            length = int(self.headers.get('Content-Length') or 0)
            body = self.rfile.read(length) if length else b''
            payload = json.loads(body.decode('utf-8') or '{}')
        except json.JSONDecodeError:
            self._write_json(HTTPStatus.BAD_REQUEST, {'error': 'Invalid JSON payload'})
            return

        try:
            data = replace_data(payload)
            self._write_json(HTTPStatus.OK, data)
        except ValueError as exc:
            self._write_json(HTTPStatus.BAD_REQUEST, {'error': str(exc)})
        except Exception as exc:  # pylint: disable=broad-except
            logging.exception('Failed to handle PUT /data')
            self._write_json(HTTPStatus.INTERNAL_SERVER_ERROR, {'error': 'Internal server error', 'details': str(exc)})

    def do_DELETE(self) -> None:  # noqa: N802 - required name
        parsed_path = urlsplit(self.path).path
        if parsed_path != '/data':
            self._write_json(HTTPStatus.NOT_FOUND, {'error': 'Not found'})
            return
        try:
            clear_data()
            self.send_response(HTTPStatus.NO_CONTENT)
            self.send_cors_headers()
            self.end_headers()
        except Exception as exc:  # pylint: disable=broad-except
            logging.exception('Failed to handle DELETE /data')
            self._write_json(HTTPStatus.INTERNAL_SERVER_ERROR, {'error': 'Internal server error', 'details': str(exc)})

    def _write_json(self, status: HTTPStatus, payload: Dict[str, Any]) -> None:
        data = json.dumps(payload).encode('utf-8')
        self.send_response(status)
        self.send_cors_headers()
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def run_server(host: str = '0.0.0.0', port: int = 3001) -> None:
    initialise_db()
    server_address = (host, port)
    httpd = ThreadingHTTPServer(server_address, TaskOrganizerHandler)
    logging.info('Task Organizer backend running on %s:%s', host, port)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        logging.info('Received shutdown signal, stopping server...')
    finally:
        httpd.server_close()


if __name__ == '__main__':
    env_port = os.getenv('PORT')
    run_server(port=int(env_port) if env_port else 3001)

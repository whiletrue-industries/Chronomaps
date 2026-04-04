#!/usr/bin/env python3
"""
Migration script: Baserow -> chronomaps-server

Usage:
  python migrate.py <directory_db_id> <service_account_key_path>

Creates workspaces and migrates all data. Idempotent - safe to run multiple times.
Admin keys are cached locally in migrate_keys.json between runs.

Requires: pip install requests firebase-admin
"""

import sys
import json
import uuid
import mimetypes
from urllib.parse import urlparse

import requests
import firebase_admin
from firebase_admin import credentials, firestore, storage

BASEROW_ENDPOINT = 'https://manage.chronomaps.net'
BASEROW_ADMIN_TOKEN = 'M848mzHlYh36iWPJ1Y9PxxxIburb5z5z'
CHRONOMAPS_API = 'https://chronomaps-api-qjzuw7ypfq-ez.a.run.app'
STORAGE_BUCKET = 'chronomaps3-eu'
KEYS_FILE = 'migrate_keys.json'

_firestore_db = None
_storage_bucket = None


def get_firestore_db():
    global _firestore_db
    if _firestore_db is None:
        _firestore_db = firestore.client()
    return _firestore_db


def get_storage_bucket():
    global _storage_bucket
    if _storage_bucket is None:
        _storage_bucket = storage.bucket(STORAGE_BUCKET)
    return _storage_bucket


# --- Key cache ---

def load_keys() -> dict:
    try:
        with open(KEYS_FILE) as f:
            return json.load(f)
    except FileNotFoundError:
        return {}


def save_keys(keys: dict):
    with open(KEYS_FILE, 'w') as f:
        json.dump(keys, f, indent=2)


# --- Workspace management (direct Firestore access) ---

def ensure_workspace(workspace_id: str, public: bool = True) -> str:
    """Create workspace if needed via direct Firestore access. Returns admin key. Idempotent."""
    keys_cache = load_keys()

    # Check cache first
    if workspace_id in keys_cache:
        admin_key = keys_cache[workspace_id]
        # Verify it still works
        try:
            resp = requests.get(
                f'{CHRONOMAPS_API}/{workspace_id}',
                headers={'Authorization': admin_key}
            )
            if resp.status_code == 200:
                return admin_key
        except Exception:
            pass

    db = get_firestore_db()
    config_ref = db.collection(workspace_id).document('.config')
    existing = config_ref.get()

    if existing.exists:
        config = existing.to_dict()
        admin_key = config['keys']['admin']
    else:
        keys = {
            'admin': str(uuid.uuid4()),
            'collaborate': str(uuid.uuid4()),
            'view': str(uuid.uuid4()),
        }
        config = {
            'metadata': {},
            'keys': keys,
            'config': {'collaborate': False, 'public': public},
        }
        config_ref.set(config)
        admin_key = keys['admin']
        print(f'    Created workspace {workspace_id}')

    # Ensure public access
    if public:
        config_ref.update({'config.public': True})

    keys_cache[workspace_id] = admin_key
    save_keys(keys_cache)
    return admin_key


def delete_all_items(workspace_id: str, admin_key: str):
    """Delete all items in a workspace (idempotent)."""
    resp = requests.delete(
        f'{CHRONOMAPS_API}/{workspace_id}/items',
        headers={'Authorization': admin_key}
    )
    if resp.status_code == 404:
        return
    resp.raise_for_status()


# --- Baserow helpers ---

def upload_to_storage(url: str, storage_path: str) -> str | None:
    """Download a file from URL and upload to Firebase Storage. Returns public URL."""
    if not url:
        return None
    try:
        resp = requests.get(url, timeout=60)
        resp.raise_for_status()
        content_type = resp.headers.get('Content-Type', '').split(';')[0].strip()
        if not content_type:
            ext = urlparse(url).path.rsplit('.', 1)[-1].lower()
            content_type = mimetypes.types_map.get(f'.{ext}', 'application/octet-stream')
        bucket = get_storage_bucket()
        blob = bucket.blob(storage_path)
        blob.upload_from_string(resp.content, content_type=content_type)
        blob.make_public()
        return blob.public_url
    except Exception as e:
        print(f'  WARNING: Failed to upload {url}: {e}')
        return None


def fetch_baserow_tables(db_id: int, token: str) -> list:
    resp = requests.get(
        f'{BASEROW_ENDPOINT}/api/database/tables/database/{db_id}/',
        headers={'Authorization': f'Token {token}'}
    )
    resp.raise_for_status()
    return resp.json()


def fetch_baserow_rows(table_id: int, token: str) -> list:
    rows = []
    url = f'{BASEROW_ENDPOINT}/api/database/rows/table/{table_id}/?user_field_names=true&size=200'
    while url:
        resp = requests.get(url, headers={'Authorization': f'Token {token}'})
        resp.raise_for_status()
        data = resp.json()
        rows.extend(data.get('results', []))
        url = data.get('next')
    return rows


def find_table(tables: list, name: str) -> dict | None:
    for t in tables:
        if t['name'] == name:
            return t
    return None


# --- Data conversion ---

def settings_rows_to_metadata(rows: list, workspace_id: str) -> dict:
    """Convert Baserow Settings table rows (Key/Value/Image) to flat metadata dict."""
    meta = {}
    for row in rows:
        key = row.get('Key', '')
        value = row.get('Value', '')
        images = row.get('Image', [])
        if images:
            if key == 'Logos':
                urls = []
                for i, img in enumerate(images):
                    if img.get('url'):
                        uploaded = upload_to_storage(img['url'], f'{workspace_id}/settings/logos_{i}{_ext(img["url"])}')
                        if uploaded:
                            urls.append(uploaded)
                meta[key] = urls
                if value:
                    meta['Logo_Links'] = value
            else:
                if images[0].get('url'):
                    uploaded = upload_to_storage(images[0]['url'], f'{workspace_id}/settings/{key}{_ext(images[0]["url"])}')
                    meta[key] = uploaded or value
                else:
                    meta[key] = value
        else:
            meta[key] = value
    return meta


def _ext(url: str) -> str:
    """Extract file extension from URL."""
    path = urlparse(url).path
    if '.' in path.rsplit('/', 1)[-1]:
        return '.' + path.rsplit('.', 1)[-1].lower()
    return ''


def flatten_content_row(row: dict, workspace_id: str) -> dict:
    """Convert a Baserow Content table row to flat metadata for the new API."""
    row_id = row.get('id', 'unknown')
    meta = {
        '_private_moderation': 3,
        'id': row_id,
        'Title': row.get('Title'),
        'Notes': row.get('Notes'),
        'Post_Timestamp': row.get('Post_Timestamp'),
        'Alt_Post_Timestamp': row.get('Alt_Post_Timestamp'),
        'Status': row['Status']['value'] if isinstance(row.get('Status'), dict) else row.get('Status'),
        'Type': row['Type']['value'] if isinstance(row.get('Type'), dict) else row.get('Type'),
        'Youtube_Video_Id': row.get('Youtube_Video_Id'),
        'Content': row.get('Content'),
        'Name': row.get('Name'),
        'Username': row.get('Username'),
        'Like_Count': row.get('Like_Count', 0),
        'Comment_Count': row.get('Comment_Count', 0),
        'Link_Title': row.get('Link_Title'),
        'Link_Domain': row.get('Link_Domain'),
        'Geo': row.get('Geo'),
        'Nonce': row.get('Nonce'),
        'Properties': row.get('Properties'),
        'Last_Modified': row.get('Last_Modified'),
    }

    # Image/audio fields -> upload to Firebase Storage
    for field in ['Image', 'Audio', 'Profile_Image']:
        val = row.get(field)
        if isinstance(val, list) and val and val[0].get('url'):
            src_url = val[0]['url']
            storage_path = f'{workspace_id}/items/{row_id}/{field}{_ext(src_url)}'
            meta[field] = upload_to_storage(src_url, storage_path)
        else:
            meta[field] = None

    # Multi-value fields -> flat arrays
    meta['Map_Layer'] = [x['value'] for x in row.get('Map_Layer', []) if isinstance(x, dict)]
    meta['Authors'] = [x['value'] for x in row.get('Authors', []) if isinstance(x, dict)]
    meta['Tags'] = [x['value'] for x in row.get('Tags', []) if isinstance(x, dict)]
    meta['Related'] = [x['id'] for x in row.get('Related', []) if isinstance(x, dict)]

    return {k: v for k, v in meta.items() if v is not None}


# --- API write helpers ---

def update_workspace_metadata(workspace_id: str, admin_key: str, metadata: dict):
    resp = requests.put(
        f'{CHRONOMAPS_API}/{workspace_id}',
        headers={'Authorization': admin_key, 'Content-Type': 'application/json'},
        json=metadata
    )
    resp.raise_for_status()
    return resp.json()


def create_item(workspace_id: str, admin_key: str, item_metadata: dict):
    resp = requests.post(
        f'{CHRONOMAPS_API}/{workspace_id}',
        headers={'Authorization': admin_key, 'Content-Type': 'application/json'},
        json=item_metadata
    )
    resp.raise_for_status()
    return resp.json()


# --- Migration logic ---

def check_baserow_db_exists(db_id: int, token: str) -> bool:
    """Check if a Baserow database is accessible."""
    try:
        resp = requests.get(
            f'{BASEROW_ENDPOINT}/api/database/tables/database/{db_id}/',
            headers={'Authorization': f'Token {token}'}
        )
        return resp.status_code == 200
    except Exception:
        return False


def migrate_chronomap(chronomap_row: dict, workspace_id: str, admin_key: str):
    db_id = chronomap_row['Database_ID']
    token = chronomap_row['Database_Token']
    slug = chronomap_row.get('URL_Slug', '')
    print(f'  Migrating chronomap: {slug} (DB {db_id}) -> {workspace_id}')

    tables = fetch_baserow_tables(db_id, token)

    # Settings -> workspace metadata
    settings_table = find_table(tables, 'Settings')
    meta = {}
    if settings_table:
        settings_rows = fetch_baserow_rows(settings_table['id'], token)
        meta = settings_rows_to_metadata(settings_rows, workspace_id)

    # MapLayers -> metadata.MapLayers
    map_layers_table = find_table(tables, 'MapLayers')
    if map_layers_table:
        ml_rows = fetch_baserow_rows(map_layers_table['id'], token)
        meta['MapLayers'] = [
            {
                'Name': r.get('Name', ''),
                'On_Layers': [x['value'] for x in r.get('On_Layers', []) if isinstance(x, dict)]
            }
            for r in ml_rows
        ]

    # Authors -> metadata.Authors
    authors_table = find_table(tables, 'Authors')
    if authors_table:
        auth_rows = fetch_baserow_rows(authors_table['id'], token)
        meta['Authors'] = [
            {
                'Name': r.get('Name', ''),
                'Email': r.get('Email', ''),
                'Status': r['Status']['value'] if isinstance(r.get('Status'), dict) else r.get('Status', ''),
            }
            for r in auth_rows
        ]

    print(f'    Updating workspace metadata ({len(meta)} fields)')
    update_workspace_metadata(workspace_id, admin_key, meta)

    # Delete existing items before re-creating (idempotent)
    print(f'    Clearing existing items')
    delete_all_items(workspace_id, admin_key)

    # Content -> items
    content_table = find_table(tables, 'Content')
    if content_table:
        content_rows = fetch_baserow_rows(content_table['id'], token)
        print(f'    Migrating {len(content_rows)} content items')
        for row in content_rows:
            item_meta = flatten_content_row(row, workspace_id)
            create_item(workspace_id, admin_key, item_meta)
    else:
        print('    No Content table found')


def migrate_directory(db_id: int):
    workspace_id = f'chronomaps-{db_id}'
    print(f'Migrating directory DB {db_id} -> {workspace_id}')

    # Ensure directory workspace exists
    admin_key = ensure_workspace(workspace_id)
    print(f'  Directory workspace ready (admin key cached)')

    tables = fetch_baserow_tables(db_id, BASEROW_ADMIN_TOKEN)

    # Directory Settings -> workspace metadata
    settings_table = find_table(tables, 'Settings')
    if settings_table:
        settings_rows = fetch_baserow_rows(settings_table['id'], BASEROW_ADMIN_TOKEN)
        meta = settings_rows_to_metadata(settings_rows, workspace_id)
        print(f'  Updating directory workspace metadata ({len(meta)} fields)')
        update_workspace_metadata(workspace_id, admin_key, meta)

    # Delete existing directory items before re-creating (idempotent)
    print(f'  Clearing existing directory items')
    delete_all_items(workspace_id, admin_key)

    # Chronomaps -> items in directory workspace + individual chronomap workspaces
    chronomaps_table = find_table(tables, 'Chronomaps')
    if not chronomaps_table:
        print('  No Chronomaps table found')
        return

    chronomap_rows = fetch_baserow_rows(chronomaps_table['id'], BASEROW_ADMIN_TOKEN)
    print(f'  Found {len(chronomap_rows)} chronomaps')

    for row in chronomap_rows:
        slug = row.get('URL_Slug', '')
        status = row['Status']['value'] if isinstance(row.get('Status'), dict) else row.get('Status', '')
        chronomap_workspace_id = f'chronomaps-{db_id}-{slug}'

        if status != 'Published' or not row.get('Database_ID') or not row.get('Database_Token'):
            print(f'  Skipping {slug} (status={status})')
            continue

        # Check if the Baserow database still exists
        db_exists = check_baserow_db_exists(row['Database_ID'], row['Database_Token'])

        # Create item in directory workspace
        item_meta = {
            '_private_moderation': 3,
            'Title': row.get('Title', ''),
            'URL_Slug': slug,
            'Status': status if db_exists else 'Deleted',
            'Editor_Name': row.get('Editor_Name', ''),
            'Editor_Email': row.get('Editor_Email', ''),
            'Pitch': row.get('Pitch', ''),
            'Workspace_ID': chronomap_workspace_id,
        }

        if not db_exists:
            print(f'  WARNING: {slug} - Baserow database {row["Database_ID"]} not found, marking as Deleted')
            create_item(workspace_id, admin_key, item_meta)
            continue

        print(f'  Creating directory item: {slug}')
        create_item(workspace_id, admin_key, item_meta)

        # Migrate the chronomap's own workspace
        chronomap_admin_key = ensure_workspace(chronomap_workspace_id)
        print(f'    Chronomap workspace ready')
        migrate_chronomap(row, chronomap_workspace_id, chronomap_admin_key)

def main():
    if len(sys.argv) < 3:
        print(f'Usage: {sys.argv[0]} <directory_db_id> <service_account_key>')
        print()
        print('Arguments:')
        print('  directory_db_id      Baserow database ID for the directory to migrate')
        print('  service_account_key  Path to a Firebase service account JSON key file')
        print()
        print('The service account key can be found at:')
        print('  ~/Code/art/chronomaps-server/serviceAccountKey.json')
        print()
        print('Or generate a new one from the Firebase Console:')
        print('  Project Settings > Service accounts > Generate new private key')
        print()
        print('Admin keys for created workspaces are cached in migrate_keys.json.')
        print('The script is idempotent - safe to run multiple times.')
        sys.exit(1)

    db_id = int(sys.argv[1])
    sa_key_path = sys.argv[2]

    # Initialize Firebase Admin SDK
    cred = credentials.Certificate(sa_key_path)
    firebase_admin.initialize_app(cred, {'storageBucket': STORAGE_BUCKET})

    migrate_directory(db_id)
    print('Migration complete!')


if __name__ == '__main__':
    main()

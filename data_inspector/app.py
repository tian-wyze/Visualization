from flask import Flask, request, jsonify, send_file, render_template
import json
import os
import glob as _glob
from io import BytesIO

app = Flask(__name__, template_folder='templates', static_folder='static')

# State: {gallery_key: {display_name, server_path, identities, stats}}
_state = {'galleries': {}}

SAVED_PATHS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.saved_paths.json')


# ── Persistence ───────────────────────────────────────────────────────────────

def _read_saved():
    try:
        with open(SAVED_PATHS_FILE) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {'galleries': {}}


def _write_saved(data):
    try:
        with open(SAVED_PATHS_FILE, 'w') as f:
            json.dump(data, f, indent=2)
    except Exception as e:
        print(f'Warning: could not write saved paths: {e}')


def _persist_gallery_path(gk, path):
    d = _read_saved()
    d.setdefault('galleries', {})[gk] = path
    _write_saved(d)


def _forget_gallery(gk):
    d = _read_saved()
    d.get('galleries', {}).pop(gk, None)
    _write_saved(d)


def _gk_from_display(display_name):
    return os.path.splitext(os.path.basename(display_name))[0]


# ── Gallery ingest ────────────────────────────────────────────────────────────

def _ingest_gallery(data, display_name, server_path=None):
    """Parse a household-info JSON into _state.

    Expected structure:
        {household_id: {identity_id: {mac_addr: [image_path, ...]}}}
    """
    if not isinstance(data, dict) or not data:
        raise ValueError('Expected a non-empty JSON object')

    # Quick structural validation on first entry
    first_hval = next(iter(data.values()))
    if not isinstance(first_hval, dict):
        raise ValueError(
            'Unexpected JSON structure. Expected: '
            'household_id → identity_id → mac_addr → [image_paths]'
        )

    gk = _gk_from_display(display_name)

    identities = []
    total_query   = 0
    total_gallery = 0

    for household_id, household_data in data.items():
        if not isinstance(household_data, dict):
            continue
        for identity_id, identity_data in household_data.items():
            if not isinstance(identity_data, dict):
                continue
            images_by_mac = {}
            q_count = 0
            g_count = 0
            for mac_addr, mac_data in identity_data.items():
                # Support both old format (flat list → all gallery) and new format
                # (dict with 'query' / 'gallery' keys).
                if isinstance(mac_data, list):
                    entry = {'query': [], 'gallery': mac_data}
                elif isinstance(mac_data, dict):
                    entry = {
                        'query':   [p for p in mac_data.get('query',   []) if isinstance(p, str)],
                        'gallery': [p for p in mac_data.get('gallery', []) if isinstance(p, str)],
                    }
                else:
                    continue
                images_by_mac[mac_addr] = entry
                q_count += len(entry['query'])
                g_count += len(entry['gallery'])
            identities.append({
                'identity_id':  identity_id,
                'household_id': household_id,
                'images_by_mac': images_by_mac,
                'num_query':    q_count,
                'num_gallery':  g_count,
                'total_images': q_count + g_count,
                'num_macs':     len(images_by_mac),
            })
            total_query   += q_count
            total_gallery += g_count

    # Sort by (household_id, identity_id) for consistent ordering
    identities.sort(key=lambda x: (x['household_id'], x['identity_id']))

    num_households = len({i['household_id'] for i in identities})
    num_identities = len(identities)

    # Per-household identity count for singleton/family stats
    hid_counts: dict = {}
    for identity in identities:
        hid_counts[identity['household_id']] = hid_counts.get(identity['household_id'], 0) + 1
    singleton_hh = sum(1 for c in hid_counts.values() if c == 1)

    total_images = total_query + total_gallery
    image_counts = [i['total_images'] for i in identities]
    stats = {
        'num_households':             num_households,
        'num_identities':             num_identities,
        'num_images':                 total_images,
        'num_query_images':           total_query,
        'num_gallery_images':         total_gallery,
        'num_singleton_households':   singleton_hh,
        'num_family_households':      num_households - singleton_hh,
        'avg_images_per_identity':    round(total_images / max(num_identities, 1), 1),
        'max_images_per_identity':    max(image_counts) if image_counts else 0,
        'min_images_per_identity':    min(image_counts) if image_counts else 0,
    }

    _state['galleries'][gk] = {
        'display_name': display_name,
        'server_path':  server_path,
        'identities':   identities,
        'stats':        stats,
        'hid_size_map': hid_counts,   # {household_id: num_identities}
    }

    return {'status': 'ok', 'gallery_key': gk, 'display_name': display_name, 'stats': stats}


# ── Auto-load on startup ──────────────────────────────────────────────────────

def _auto_load():
    saved = _read_saved()
    for gk, path in saved.get('galleries', {}).items():
        if not path or not os.path.isfile(path):
            if path:
                print(f'[auto-load] Gallery not found, skipping: {path}')
            continue
        try:
            with open(path) as f:
                data = json.load(f)
            result = _ingest_gallery(data, os.path.basename(path), path)
            s = result['stats']
            print(
                f'[auto-load] Gallery "{gk}": '
                f'{s["num_households"]} households, '
                f'{s["num_identities"]} identities, '
                f'{s["num_images"]} images'
            )
        except Exception as e:
            print(f'[auto-load] Could not load gallery {path}: {e}')


_auto_load()


# ── Routes ────────────────────────────────────────────────────────────────────

@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/upload_gallery', methods=['POST'])
def upload_gallery():
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400
    f = request.files['file']
    try:
        result = _ingest_gallery(json.load(f), f.filename, None)
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 400


@app.route('/api/load_gallery_path', methods=['POST'])
def load_gallery_path():
    path = request.get_json(force=True).get('path', '').strip()
    if not path:
        return jsonify({'error': 'Path is required'}), 400

    # ── Folder: scan for all .json files ────────────────────────────────────
    if os.path.isdir(path):
        json_files = sorted(_glob.glob(os.path.join(path, '*.json')))
        if not json_files:
            return jsonify({'error': f'No .json files found in folder: {path}'}), 404
        loaded, skipped = [], []
        for fpath in json_files:
            try:
                with open(fpath) as f:
                    data = json.load(f)
                result = _ingest_gallery(data, os.path.basename(fpath), fpath)
                _persist_gallery_path(result['gallery_key'], fpath)
                loaded.append(result)
            except Exception as e:
                skipped.append({'file': os.path.basename(fpath), 'reason': str(e)})
        if not loaded:
            return jsonify({'error': 'No valid gallery JSON files found.', 'skipped': skipped}), 400
        return jsonify({'batch': True, 'loaded': loaded, 'skipped': skipped})

    # ── Single file ──────────────────────────────────────────────────────────
    if not os.path.isfile(path):
        return jsonify({'error': f'Path not found on server: {path}'}), 404
    try:
        with open(path) as f:
            data = json.load(f)
        result = _ingest_gallery(data, os.path.basename(path), path)
        _persist_gallery_path(result['gallery_key'], path)
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 400


@app.route('/api/delete_gallery', methods=['POST'])
def delete_gallery():
    gk = request.get_json(force=True).get('gallery', '')
    _state['galleries'].pop(gk, None)
    _forget_gallery(gk)
    return jsonify({'status': 'ok'})


@app.route('/api/state')
def get_state():
    return jsonify({
        'galleries': {
            gk: {
                'display_name': gdata['display_name'],
                'server_path':  gdata.get('server_path'),
                'stats':        gdata['stats'],
            }
            for gk, gdata in _state['galleries'].items()
        }
    })


@app.route('/api/saved_paths')
def get_saved_paths():
    return jsonify(_read_saved())


@app.route('/api/households')
def get_households():
    gk = request.args.get('gallery', '')
    if gk not in _state['galleries']:
        return jsonify({'households': []})

    hid_map: dict = {}
    for identity in _state['galleries'][gk]['identities']:
        hid = identity['household_id']
        if hid not in hid_map:
            hid_map[hid] = {'household_id': hid, 'num_identities': 0, 'num_images': 0}
        hid_map[hid]['num_identities'] += 1
        hid_map[hid]['num_images'] += identity['total_images']

    return jsonify({'households': sorted(hid_map.values(), key=lambda x: x['household_id'])})


@app.route('/api/identities')
def get_identities():
    gk = request.args.get('gallery', '')
    if gk not in _state['galleries']:
        return jsonify({'identities': [], 'total': 0})

    identities = _state['galleries'][gk]['identities']

    household_filter = request.args.get('household', '').strip()
    hh_size          = request.args.get('hh_size', '').strip()
    search           = request.args.get('search', '').strip().lower()
    sort_by          = request.args.get('sort_by', 'household')
    page             = int(request.args.get('page', 0))
    page_size        = int(request.args.get('page_size', 10))

    if household_filter:
        identities = [i for i in identities if i['household_id'] == household_filter]
    if hh_size:
        try:
            hh_size_int  = int(hh_size)
            hid_size_map = _state['galleries'][gk].get('hid_size_map', {})
            identities   = [i for i in identities
                            if hid_size_map.get(i['household_id'], 0) == hh_size_int]
        except ValueError:
            pass
    if search:
        identities = [
            i for i in identities
            if search in i['identity_id'].lower() or search in i['household_id'].lower()
        ]

    if sort_by == 'identity':
        identities = sorted(identities, key=lambda x: x['identity_id'])
    elif sort_by == 'images_desc':
        identities = sorted(identities, key=lambda x: -x['total_images'])
    elif sort_by == 'images_asc':
        identities = sorted(identities, key=lambda x: x['total_images'])
    # 'household' order is already precomputed

    total = len(identities)
    return jsonify({
        'identities': identities[page * page_size:(page + 1) * page_size],
        'total':      total,
    })


@app.route('/api/image')
def serve_image():
    path = request.args.get('path', '')
    if path and os.path.isfile(path):
        resp = send_file(path)
        resp.headers['Cache-Control'] = 'public, max-age=3600'
        return resp
    # Return a grey placeholder
    try:
        from PIL import Image, ImageDraw
        img  = Image.new('RGB', (80, 120), (220, 220, 225))
        draw = ImageDraw.Draw(img)
        draw.rectangle([2, 2, 77, 117], outline=(180, 180, 190), width=2)
        draw.text((8, 55), 'Not\nFound', fill=(160, 160, 170))
        buf = BytesIO()
        img.save(buf, format='PNG')
        buf.seek(0)
        return send_file(buf, mimetype='image/png')
    except Exception:
        return '', 404


if __name__ == '__main__':
    print('Starting Data Inspector on http://localhost:5001')
    app.run(debug=True, port=5001)

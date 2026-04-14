from flask import Flask, request, jsonify, send_file, render_template
import json
import pandas as pd
import os
from io import BytesIO

app = Flask(__name__, template_folder='templates', static_folder='static')

# Each benchmark lives under its own key (derived from the JSON filename stem).
# Structure: {bk: {eval_cases, display_name, models: {name: {predictions, accuracy}}}}
_state = {'benchmarks': {}}


# ── Saved-paths persistence ───────────────────────────────────────────────────
# Format: {"benchmarks": {"bk": {"path": "/abs/bench.json",
#                                 "models": [{"name": "X", "path": "/abs/pred.csv"}]}}}

SAVED_PATHS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.saved_paths.json')


def _read_saved():
    try:
        with open(SAVED_PATHS_FILE) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {'benchmarks': {}}


def _write_saved(data):
    try:
        with open(SAVED_PATHS_FILE, 'w') as f:
            json.dump(data, f, indent=2)
    except Exception as e:
        print(f'Warning: could not write saved paths: {e}')


def _persist_benchmark_path(bk, path):
    d = _read_saved()
    d.setdefault('benchmarks', {}).setdefault(bk, {'path': None, 'models': []})['path'] = path
    _write_saved(d)


def _persist_model_path(bk, name, path):
    d = _read_saved()
    bdata = d.setdefault('benchmarks', {}).setdefault(bk, {'path': None, 'models': []})
    bdata['models'] = [m for m in bdata.get('models', []) if m['name'] != name]
    bdata['models'].append({'name': name, 'path': path})
    _write_saved(d)


def _forget_model(bk, name):
    d = _read_saved()
    if bk in d.get('benchmarks', {}):
        d['benchmarks'][bk]['models'] = [
            m for m in d['benchmarks'][bk].get('models', []) if m['name'] != name
        ]
        _write_saved(d)


def _forget_benchmark(bk):
    d = _read_saved()
    d.get('benchmarks', {}).pop(bk, None)
    _write_saved(d)


# ── Benchmark-key helpers ─────────────────────────────────────────────────────

def _bk_from_display_name(display_name):
    """Strip path and extension to get the benchmark key."""
    return os.path.splitext(os.path.basename(display_name))[0]


def _detect_bk_for_csv(filename):
    """Match a CSV filename to a known benchmark key by suffix.

    Convention: predictions_{anything}_{benchmark_key}.csv
    Tries longest benchmark key first to avoid partial matches.
    """
    stem = os.path.splitext(os.path.basename(filename))[0]
    for bk in sorted(_state['benchmarks'], key=len, reverse=True):
        if stem.endswith('_' + bk) or stem == bk:
            return bk
    return None


def _parse_predictions_filename(filename):
    """Parse model name and benchmark key from a predictions CSV filename.

    Convention: predictions_{model_name}_{benchmark_key}.csv

    Model names may themselves contain underscores (e.g. sft-qwen3b-WYZEv03_23_token),
    so we cannot simply split at the first underscore. Strategy:

    1. Match against loaded benchmark keys (longest first) — unambiguous and
       handles any model name correctly when benchmarks are already in memory.
    2. Fall back to finding the first '_cropped_' separator — works for the
       standard benchmark naming convention (cropped_*) without needing loaded state.
    """
    stem = os.path.splitext(os.path.basename(filename))[0]
    if not stem.startswith('predictions_'):
        return None, None
    remainder = stem[len('predictions_'):]

    # Strategy 1: match against loaded benchmark keys (longest first)
    for bk in sorted(_state['benchmarks'], key=len, reverse=True):
        suffix = '_' + bk
        if remainder.endswith(suffix):
            model_name = remainder[:-len(suffix)]
            if model_name:
                return model_name, bk

    # Strategy 2: heuristic — split at first '_cropped_'
    marker = '_cropped_'
    idx = remainder.find(marker)
    if idx != -1:
        model_name = remainder[:idx]
        bk         = remainder[idx + 1:]   # drop the leading '_'
        if model_name and bk:
            return model_name, bk

    return None, None


# ── Shared ingest helpers ─────────────────────────────────────────────────────

def _ingest_benchmark(data, display_name):
    if 'eval_cases' not in data:
        raise ValueError('JSON must contain an "eval_cases" key')
    bk = _bk_from_display_name(display_name)
    # Preserve existing models when reloading the same benchmark
    existing_models = _state['benchmarks'].get(bk, {}).get('models', {})
    _state['benchmarks'][bk] = {
        'eval_cases':   data['eval_cases'],
        'display_name': display_name,
        'models':       existing_models,
    }
    return {'status': 'ok', 'benchmark_key': bk,
            'num_cases': len(data['eval_cases']), 'name': display_name}


def _ingest_model(df, name, bk):
    if bk not in _state['benchmarks']:
        raise ValueError(f'Benchmark "{bk}" is not loaded')
    if 'idx' in df.columns:
        df = df.set_index('idx')
    if not {'label', 'prediction'}.issubset(df.columns):
        raise ValueError('CSV must have columns: label, prediction (and optionally idx)')
    preds = {
        int(idx): {'label': int(row['label']), 'prediction': int(row['prediction'])}
        for idx, row in df.iterrows()
    }
    accuracy = round((df['label'] == df['prediction']).mean() * 100, 1)
    _state['benchmarks'][bk]['models'][name] = {'predictions': preds, 'accuracy': accuracy}
    return {'status': 'ok', 'name': name, 'benchmark_key': bk, 'accuracy': accuracy}


# ── Auto-load on startup ──────────────────────────────────────────────────────

def _auto_load():
    saved = _read_saved()
    for bk, bdata in saved.get('benchmarks', {}).items():
        bpath = bdata.get('path')
        if not bpath:
            continue
        if not os.path.isfile(bpath):
            print(f'[auto-load] Benchmark not found, skipping: {bpath}')
            continue
        try:
            with open(bpath) as f:
                _ingest_benchmark(json.load(f), os.path.basename(bpath))
            print(f'[auto-load] Benchmark "{bk}": {len(_state["benchmarks"][bk]["eval_cases"])} cases')
        except Exception as e:
            print(f'[auto-load] Could not load benchmark {bpath}: {e}')
            continue
        for m in bdata.get('models', []):
            mpath, mname = m.get('path', ''), m.get('name', '')
            if not mpath or not mname or not os.path.isfile(mpath):
                if mpath:
                    print(f'[auto-load] Model path not found, skipping: {mpath}')
                continue
            try:
                _ingest_model(pd.read_csv(mpath), mname, bk)
                print(f'[auto-load] Model "{mname}" → "{bk}": '
                      f'{_state["benchmarks"][bk]["models"][mname]["accuracy"]}%')
            except Exception as e:
                print(f'[auto-load] Could not load model "{mname}": {e}')


_auto_load()


# ── Routes ────────────────────────────────────────────────────────────────────

@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/upload_benchmark', methods=['POST'])
def upload_benchmark():
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400
    f = request.files['file']
    try:
        return jsonify(_ingest_benchmark(json.load(f), f.filename))
    except Exception as e:
        return jsonify({'error': str(e)}), 400


@app.route('/api/load_benchmark_path', methods=['POST'])
def load_benchmark_path():
    path = request.get_json(force=True).get('path', '').strip()
    if not path:
        return jsonify({'error': 'Path is required'}), 400

    # ── Folder: scan for all .json files ────────────────────────────────────
    if os.path.isdir(path):
        import glob as _glob
        json_files = sorted(_glob.glob(os.path.join(path, '*.json')))
        if not json_files:
            return jsonify({'error': f'No .json files found in folder: {path}'}), 404
        loaded, skipped = [], []
        for fpath in json_files:
            try:
                with open(fpath) as f:
                    data = json.load(f)
                if 'eval_cases' not in data:
                    skipped.append(os.path.basename(fpath))
                    continue
                result = _ingest_benchmark(data, os.path.basename(fpath))
                _persist_benchmark_path(result['benchmark_key'], fpath)
                loaded.append(result)
            except Exception:
                skipped.append(os.path.basename(fpath))
        if not loaded:
            return jsonify({'error': 'No valid benchmark JSON files found in folder '
                                     f'(need "eval_cases" key). Skipped: {skipped}'}), 400
        return jsonify({'batch': True, 'loaded': loaded, 'skipped': skipped})

    # ── Single file ──────────────────────────────────────────────────────────
    if not os.path.isfile(path):
        return jsonify({'error': f'Path not found on server: {path}'}), 404
    try:
        with open(path) as f:
            data = json.load(f)
        result = _ingest_benchmark(data, os.path.basename(path))
        _persist_benchmark_path(result['benchmark_key'], path)
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 400


@app.route('/api/upload_model', methods=['POST'])
def upload_model():
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400
    name = request.form.get('name', '').strip()
    if not name:
        return jsonify({'error': 'Model name is required'}), 400
    f = request.files['file']
    bk = (request.form.get('benchmark', '').strip()
          or _detect_bk_for_csv(f.filename))
    if not bk:
        return jsonify({'error': 'Could not auto-detect benchmark from filename',
                        'benchmarks': list(_state['benchmarks'].keys())}), 400
    try:
        return jsonify(_ingest_model(pd.read_csv(f), name, bk))
    except Exception as e:
        return jsonify({'error': str(e)}), 400


@app.route('/api/load_model_path', methods=['POST'])
def load_model_path():
    body = request.get_json(force=True)
    path = body.get('path', '').strip()
    name = body.get('name', '').strip()
    if not path:
        return jsonify({'error': 'Path is required'}), 400

    # ── Folder: scan for predictions_*.csv files ─────────────────────────────
    if os.path.isdir(path):
        import glob as _glob
        csv_files = sorted(_glob.glob(os.path.join(path, 'predictions_*.csv')))
        if not csv_files:
            return jsonify({'error': f'No predictions_*.csv files found in folder: {path}'}), 404
        loaded, skipped = [], []
        for fpath in csv_files:
            model_name, bk = _parse_predictions_filename(fpath)
            if not model_name or not bk:
                skipped.append({'file': os.path.basename(fpath),
                                'reason': 'could not parse model name or benchmark'})
                continue
            if bk not in _state['benchmarks']:
                skipped.append({'file': os.path.basename(fpath),
                                'reason': f'benchmark "{bk}" not loaded — load its JSON first'})
                continue
            try:
                result = _ingest_model(pd.read_csv(fpath), model_name, bk)
                _persist_model_path(bk, model_name, fpath)
                loaded.append(result)
            except Exception as e:
                skipped.append({'file': os.path.basename(fpath), 'reason': str(e)})
        if not loaded:
            return jsonify({'error': 'No prediction files could be loaded.',
                            'skipped': skipped}), 400
        return jsonify({'batch': True, 'loaded': loaded, 'skipped': skipped})

    # ── Single file ───────────────────────────────────────────────────────────
    if not os.path.isfile(path):
        return jsonify({'error': f'Path not found on server: {path}'}), 404
    if not name:
        # Try to parse name from filename automatically
        name, auto_bk = _parse_predictions_filename(path)
        if not name:
            return jsonify({'error': 'Model name is required (could not auto-parse from filename)'}), 400
    bk = body.get('benchmark', '').strip() or _detect_bk_for_csv(path)
    if not bk:
        return jsonify({'error': 'Could not auto-detect benchmark from filename',
                        'benchmarks': list(_state['benchmarks'].keys())}), 400
    try:
        result = _ingest_model(pd.read_csv(path), name, bk)
        _persist_model_path(bk, name, path)
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 400


@app.route('/api/delete_model', methods=['POST'])
def delete_model():
    body = request.get_json(force=True)
    name = body.get('name', '')
    bk   = body.get('benchmark', '')
    if bk in _state['benchmarks']:
        _state['benchmarks'][bk]['models'].pop(name, None)
        _forget_model(bk, name)
    return jsonify({'status': 'ok'})


@app.route('/api/delete_benchmark', methods=['POST'])
def delete_benchmark():
    bk = request.get_json(force=True).get('benchmark', '')
    _state['benchmarks'].pop(bk, None)
    _forget_benchmark(bk)
    return jsonify({'status': 'ok'})


@app.route('/api/state')
def get_state():
    return jsonify({
        'benchmarks': {
            bk: {
                'display_name': bdata['display_name'],
                'num_cases':    len(bdata['eval_cases']),
                'models': {n: {'accuracy': m['accuracy']}
                           for n, m in bdata['models'].items()},
            }
            for bk, bdata in _state['benchmarks'].items()
        }
    })


@app.route('/api/saved_paths')
def get_saved_paths():
    return jsonify(_read_saved())


@app.route('/api/cases')
def get_cases():
    bk = request.args.get('benchmark', '')
    if bk not in _state['benchmarks']:
        return jsonify({'cases': [], 'total': 0})

    bench      = _state['benchmarks'][bk]
    eval_cases = bench['eval_cases']
    models_map = bench['models']

    view       = request.args.get('view', 'single')
    model      = request.args.get('model', '')
    ftype      = request.args.get('type', 'failures')
    model2     = request.args.get('model2', '')
    cross_mode = request.args.get('cross_mode', 'fail_succeed')
    page       = int(request.args.get('page', 0))
    page_size  = int(request.args.get('page_size', 20))

    results = []

    if view == 'single' and model in models_map:
        preds = models_map[model]['predictions']
        for idx, case in enumerate(eval_cases):
            if idx not in preds:
                continue
            p = preds[idx]
            correct = p['label'] == p['prediction']
            if ftype == 'failures' and correct:
                continue
            if ftype == 'correct' and not correct:
                continue
            results.append(_make_case(idx, case, {model: p['prediction']}, p['label']))

    elif view == 'compare' and model in models_map and model2 in models_map:
        p1map = models_map[model]['predictions']
        p2map = models_map[model2]['predictions']
        for idx, case in enumerate(eval_cases):
            if idx not in p1map or idx not in p2map:
                continue
            p1, p2 = p1map[idx], p2map[idx]
            label = p1['label']
            ok1 = label == p1['prediction']
            ok2 = label == p2['prediction']
            include = {
                'fail_succeed': not ok1 and ok2,
                'succeed_fail': ok1 and not ok2,
                'both_fail':    not ok1 and not ok2,
                'both_correct': ok1 and ok2,
            }.get(cross_mode, False)
            if not include:
                continue
            results.append(_make_case(idx, case,
                                      {model: p1['prediction'], model2: p2['prediction']}, label))

    total = len(results)
    return jsonify({'cases': results[page * page_size:(page + 1) * page_size], 'total': total})


def _make_case(idx, case, model_preds, label):
    return {'idx': idx, 'query': case['query'], 'gallery': case['gallery'],
            'label': int(label), 'models': model_preds}


@app.route('/api/image')
def serve_image():
    path = request.args.get('path', '')
    if path and os.path.isfile(path):
        resp = send_file(path)
        resp.headers['Cache-Control'] = 'public, max-age=3600'
        return resp
    try:
        from PIL import Image, ImageDraw
        img = Image.new('RGB', (100, 150), (220, 220, 225))
        draw = ImageDraw.Draw(img)
        draw.rectangle([2, 2, 97, 147], outline=(180, 180, 190), width=2)
        draw.text((8, 65), "Not\nFound", fill=(160, 160, 170))
        buf = BytesIO()
        img.save(buf, format='PNG')
        buf.seek(0)
        return send_file(buf, mimetype='image/png')
    except Exception:
        return '', 404


if __name__ == '__main__':
    print('Starting Model Inspector on http://localhost:5000')
    app.run(debug=True, port=5000)

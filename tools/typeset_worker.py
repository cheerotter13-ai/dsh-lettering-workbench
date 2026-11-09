#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Long-lived render worker for lettering-workbench (contract docs/api-v2.md §5).

JSON lines on stdin/stdout. Request {"id":n,"cmd":"sprite","args":{...}};
response {"id":n,"ok":true,"result":{...}} or {"id":n,"ok":false,"error":"..."}.
On start the worker prints {"ready":true,"pid":..,"code_hash":..,"fonts_hash":..}.
It exits on stdin EOF and when the parent process dies (checked every 2 s).
"""

import hashlib
import json
import os
import sys
import threading
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import typeset_stroke as ts  # noqa: E402
from PIL import Image  # noqa: E402

CODE_FILES = ('typeset_stroke.py', 'typeset_worker.py')
NUMERIC = {'x': (0, None), 'y': (0, None), 'font_size': (8, 256), 'rotation': (-360, 360),
           'letter_spacing': (-4, 256), 'max_width': (16, 16384)}
DEFAULTS = {'font_size': 40, 'rotation': 0, 'letter_spacing': 0, 'max_width': 600}


# ---------------------------------------------------------------- hashes

def code_hash():
    digest = hashlib.sha256()
    for name in CODE_FILES:
        digest.update((HERE / name).read_bytes())
    return digest.hexdigest()


def fonts_hash():
    """sha256(manifest bytes + per font key "\\n<key>\\t<size>\\t<mtime ms>"); missing files use -1."""
    raw = ts.FONT_MANIFEST.read_bytes()
    digest = hashlib.sha256(raw)
    manifest = json.loads(raw.decode('utf-8-sig'))
    for key, entry in manifest.get('fonts', {}).items():
        path = Path(entry['path'])
        if not path.is_absolute():
            path = ts.FONT_MANIFEST.parent / path
        try:
            stat = path.stat()
            size, mtime = stat.st_size, stat.st_mtime_ns // 1_000_000
        except OSError:
            size, mtime = -1, -1
        digest.update(f'\n{key}\t{size}\t{mtime}'.encode('utf-8'))
    return digest.hexdigest()


# ---------------------------------------------------------------- helpers

def _replace_atomic(path, write):
    """Write through `<path>.<pid>.tmp` and rename over `path`."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f'{path.name}.{os.getpid()}.tmp')
    try:
        write(tmp)
        os.replace(tmp, path)
    finally:
        if tmp.exists():
            tmp.unlink()


def validate_layer(layer, language):
    """The per-layer checks of typeset_stroke.render_layout, in the same order.

    The bitmap does not depend on x/y, so a layer without them is checked as if at 0,0.
    dialogue_id uniqueness and regions are page-level and not checked here.
    """
    errors = []
    if language not in ('zh', 'ja', 'ko', 'en'):
        return ['unsupported_language']
    if not isinstance(layer, dict):
        return ['invalid_layer']
    layer = {'x': 0, 'y': 0, **layer}
    kind = layer.get('kind', 'dialogue')
    if kind not in ('dialogue', 'thought', 'narration', 'sfx'):
        return ['invalid_kind']
    if not isinstance(layer.get('text'), str) or not layer['text'].strip():
        return ['empty_text']
    color = layer.get('color', '#000000')
    if (not isinstance(color, str) or not color.startswith('#') or len(color) not in (4, 7)
            or any(c not in '0123456789abcdefABCDEF' for c in color[1:])):
        return ['invalid_color']
    for field, (minimum, maximum) in NUMERIC.items():
        value = layer.get(field, DEFAULTS.get(field))
        if not ts._number(value) or value < minimum or maximum is not None and value > maximum:
            errors.append('invalid_' + field)
    size = layer.get('font_size', 40)
    if not isinstance(size, int) or isinstance(size, bool):
        errors.append('invalid_font_size')
    if layer.get('mode', 'horizontal') not in ('horizontal', 'vertical'):
        errors.append('invalid_mode')
    if layer.get('font', kind) not in ts._manifest()['styles']:
        errors.append('invalid_font')
    if not isinstance(layer.get('locked', False), bool):
        errors.append('invalid_locked')
    return errors


def _missing_codepoints(message):
    text = str(message).split('missing_glyph:', 1)[-1]
    return [part.strip() for part in text.split(',') if part.strip()]


# ---------------------------------------------------------------- commands

def cmd_sprite(args):
    layer, language = args['layer'], args.get('language', 'zh')
    errors = validate_layer(layer, language)
    if errors:
        return {'error': errors[0], 'errors': errors, 'missing': []}
    try:
        bitmap, fonts = ts._layer_bitmap(layer, language)
    except (ValueError, OSError, KeyError) as exc:
        if 'missing_glyph' in str(exc):
            return {'error': 'missing_glyph', 'missing': _missing_codepoints(exc)}
        return {'error': 'font_or_text_error', 'detail': str(exc), 'missing': []}
    output = Path(args['output'])
    meta = {'width': bitmap.width, 'height': bitmap.height, 'fonts': fonts}
    _replace_atomic(output, lambda tmp: bitmap.save(tmp, format='PNG'))
    side = json.dumps(meta, ensure_ascii=False).encode('utf-8')
    _replace_atomic(output.with_suffix('.json'), lambda tmp: tmp.write_bytes(side))
    return meta


def _line_widths(layer, width, language):
    """Pixel width of each wrapped line, as _layer_bitmap breaks them, plus how many automatic
    breaks fall mid-phrase (not after punctuation). Layout uses both to avoid ugly wraps."""
    size = layer.get('font_size', 40)
    paths = ts._font_paths(layer.get('font', layer.get('kind', 'dialogue')), language)
    glyphs = []
    for ch in layer['text']:
        if ch == '\n':
            glyphs.append((ch, None, None)); continue
        path = next((p for p in paths if ord(ch) in ts._font_cmap(p)), None)
        if path is not None:
            glyphs.append((ch, ts._truetype(path, size), path))
    spacing = layer.get('letter_spacing', 0)
    widths, soft = [], 0
    for segment in _split_segments(glyphs):
        wrapped = ts._wrap_glyphs(segment, max(1, width - 16), spacing)
        widths += [round(sum(f.getlength(ch) + spacing for ch, f, _ in line), 1) for line in wrapped]
        soft += sum(1 for line in wrapped[:-1] if line and line[-1][0] not in ts._PHRASE_END | ts._CLAUSE_END | ts._CLOSE_PUNCT)
    return widths, soft


def _split_segments(glyphs):
    """Hard newlines are the writer's choice; only automatic breaks are judged."""
    segments, current = [], []
    for glyph in glyphs:
        if glyph[0] == '\n':
            segments.append(current); current = []
        else:
            current.append(glyph)
    segments.append(current)
    return segments


def cmd_measure(args):
    layer, language = dict(args['layer']), args.get('language', 'zh')
    widths = args.get('widths') or [layer.get('max_width', 600)]
    missing = []
    try:
        ts._layer_bitmap({**layer, 'max_width': widths[0]}, language)
    except ValueError as exc:
        if 'missing_glyph' not in str(exc):
            raise
        # Measure what can be drawn; the caller still learns which glyphs are missing.
        missing = _missing_codepoints(exc)
        drop = {chr(int(code[2:], 16)) for code in missing}
        layer['text'] = ''.join(ch for ch in layer.get('text', '') if ch not in drop)
    out = []
    for width in widths:
        entry = {'max_width': width, 'width': 0, 'height': 0}
        if layer.get('text', '').strip():
            bitmap, _ = ts._layer_bitmap({**layer, 'max_width': width}, language)
            entry.update(width=bitmap.width, height=bitmap.height)
            if layer.get('mode', 'horizontal') != 'vertical':
                entry['lines'], entry['soft_breaks'] = _line_widths(layer, width, language)
        if missing:
            entry['missing'] = missing
        out.append(entry)
    return out


def cmd_compose(args):
    source, output = Path(args['input']), Path(args['output'])
    if source.resolve() == output.resolve():
        return {'success': False, 'width': 0, 'height': 0, 'layers': [],
                'errors': [{'code': 'input_overwrite', 'dialogue_id': None, 'detail': None}]}
    tmp = output.with_name(output.name + '.tmp')
    try:
        result = ts.render_layout(str(source), str(tmp), args['document'], allow_invalid=True)
        if result.get('output_path'):
            os.replace(tmp, output)
            result['output_path'] = str(output.resolve())
        return result
    finally:
        if tmp.exists():
            tmp.unlink()


def cmd_thumb(args):
    size = int(args.get('size') or 240)
    with Image.open(args['input']) as source:
        source.draft('RGB', (size, size))
        image = source.convert('RGB')
    image.thumbnail((size, size), Image.Resampling.LANCZOS)
    _replace_atomic(args['output'], lambda tmp: image.save(tmp, format='JPEG', quality=72))
    return {'output': str(Path(args['output']).resolve()), 'width': image.width, 'height': image.height}


def cmd_image_info(args):
    with Image.open(args['path']) as image:
        width, height = image.size
    return {'width': width, 'height': height}


def cmd_ping(_args):
    return {'pong': True, 'pid': os.getpid()}


COMMANDS = {'sprite': cmd_sprite, 'measure': cmd_measure, 'compose': cmd_compose,
            'thumb': cmd_thumb, 'imageInfo': cmd_image_info, 'ping': cmd_ping}


# ---------------------------------------------------------------- protocol

def _parent_alive_checker(parent):
    """Return a function that blocks up to `seconds` and returns False once the parent is gone."""
    if os.name == 'nt':
        import ctypes
        kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)
        kernel32.OpenProcess.restype = ctypes.c_void_p
        kernel32.WaitForSingleObject.argtypes = (ctypes.c_void_p, ctypes.c_uint32)
        handle = kernel32.OpenProcess(0x00100000, False, parent)  # SYNCHRONIZE
        if not handle:
            # 87 = ERROR_INVALID_PARAMETER: no such process. Otherwise we cannot tell; rely on stdin EOF.
            gone = ctypes.get_last_error() == 87
            return lambda seconds: not gone and (time.sleep(seconds) or True)

        def wait(seconds):
            status = kernel32.WaitForSingleObject(handle, int(seconds * 1000))
            if status == 0xFFFFFFFF:  # WAIT_FAILED: do not spin
                time.sleep(seconds)
            return status != 0  # 0 = WAIT_OBJECT_0, the parent exited
        return wait

    def alive(seconds):
        time.sleep(seconds)
        return os.getppid() == parent
    return alive


def _watch_parent():
    parent = int(os.environ.get('CW_PARENT_PID') or os.getppid())
    alive = _parent_alive_checker(parent)

    def loop():
        while alive(2.0):
            pass
        os._exit(0)
    threading.Thread(target=loop, name='parent-watchdog', daemon=True).start()


def serve(commands, hello):
    """Run the JSON-lines loop until stdin closes."""
    out = sys.stdout.buffer
    sys.stdout = sys.stderr  # stray prints from libraries must not corrupt the protocol
    lock = threading.Lock()

    def send(message):
        data = (json.dumps(message, ensure_ascii=False) + '\n').encode('utf-8')
        with lock:
            out.write(data)
            out.flush()

    _watch_parent()
    send({'ready': True, 'pid': os.getpid(), **hello})
    while True:
        line = sys.stdin.buffer.readline()
        if not line:
            break
        if not line.strip():
            continue
        ident = None
        try:
            request = json.loads(line.decode('utf-8'))
            ident = request.get('id')
            handler = commands.get(request.get('cmd'))
            if handler is None:
                raise ValueError('unknown command: %s' % request.get('cmd'))
            send({'id': ident, 'ok': True, 'result': handler(request.get('args') or {})})
        except Exception as exc:  # noqa: BLE001 - every failure goes back to the caller
            send({'id': ident, 'ok': False, 'error': str(exc) or type(exc).__name__})


def main():
    serve(COMMANDS, {'code_hash': code_hash(), 'fonts_hash': fonts_hash()})


if __name__ == '__main__':
    main()

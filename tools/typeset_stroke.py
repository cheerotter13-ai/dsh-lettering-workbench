#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Local image lettering renderer: outlined text and editable layers."""

import os
import sys
import argparse
from typing import List, Tuple, Optional, Union
from PIL import Image, ImageDraw, ImageFont

DEFAULT_FONT_CANDIDATES = [
    os.path.join(os.path.dirname(__file__), '..', 'assets', 'fonts', 'LXGWWenKai-Regular.ttf'),
]

def find_system_font(preferred_font: Optional[str] = None) -> str:
    if preferred_font and os.path.exists(preferred_font):
        return preferred_font
    for candidate in DEFAULT_FONT_CANDIDATES:
        if os.path.exists(candidate):
            return candidate
    raise FileNotFoundError("未在系统中找到可用的中文字体文件。")

def hex_to_rgb(hex_str: str) -> Tuple[int, int, int]:
    hex_str = hex_str.lstrip("#")
    if len(hex_str) == 3:
        hex_str = "".join([c * 2 for c in hex_str])
    return tuple(int(hex_str[i:i+2], 16) for i in (0, 2, 4))

class ComicTypesetter:
    def __init__(self, font_path: Optional[str] = None):
        self.font_path = find_system_font(font_path)

    def _get_font(self, font_size: int) -> ImageFont.FreeTypeFont:
        return ImageFont.truetype(self.font_path, font_size)

    def render_horizontal(
        self,
        img: Image.Image,
        lines: List[str],
        anchor: str = "bottom_subtitle",
        font_size: int = 40,
        text_color: Tuple[int, int, int] = (20, 20, 25),
        stroke_color: Tuple[int, int, int] = (255, 255, 255),
        stroke_width: int = 4,
        shadow: bool = True,
        margin_x: int = 60,
        margin_y: int = 70,
        custom_pos: Optional[Tuple[float, float]] = None,
    ) -> Image.Image:
        """横排文字渲染（台词、底部字幕、旁白）"""
        W, H = img.size
        font = self._get_font(font_size)
        overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        draw = ImageDraw.Draw(overlay)

        spacing = int(font_size * 0.32)
        line_bboxes = [draw.textbbox((0, 0), line, font=font, stroke_width=stroke_width) for line in lines]
        line_widths = [b[2] - b[0] for b in line_bboxes]
        line_heights = [b[3] - b[1] for b in line_bboxes]

        total_height = sum(line_heights) + spacing * (len(lines) - 1)
        max_line_width = max(line_widths) if line_widths else 0

        if custom_pos:
            start_x_base = int(W * custom_pos[0]) if 0.0 <= custom_pos[0] <= 1.0 else int(custom_pos[0])
            start_y = int(H * custom_pos[1]) if 0.0 <= custom_pos[1] <= 1.0 else int(custom_pos[1])
            align = "center"
        elif anchor == "bottom_subtitle":
            start_y = H - total_height - margin_y
            start_x_base = W // 2
            align = "center"
        elif anchor == "top_left":
            start_y = margin_y
            start_x_base = margin_x
            align = "left"
        elif anchor == "top_right":
            start_y = margin_y
            start_x_base = W - margin_x
            align = "right"
        elif anchor == "bottom_left":
            start_y = H - total_height - margin_y
            start_x_base = margin_x
            align = "left"
        elif anchor == "bottom_right":
            start_y = H - total_height - margin_y
            start_x_base = W - margin_x
            align = "right"
        elif anchor == "center":
            start_y = (H - total_height) // 2
            start_x_base = W // 2
            align = "center"
        else:
            start_y = H - total_height - margin_y
            start_x_base = W // 2
            align = "center"

        curr_y = start_y
        for i, line in enumerate(lines):
            lw = line_widths[i]
            lh = line_heights[i]
            if align == "center":
                x = (W - lw) // 2 if not custom_pos else start_x_base - (lw // 2)
            elif align == "right":
                x = W - margin_x - lw
            else:
                x = margin_x

            # 1. 柔和投影（解决画面纯白高光处文字对比度问题）
            if shadow:
                draw.text(
                    (x + 2, curr_y + 2),
                    line,
                    font=font,
                    fill=(0, 0, 0, 85),
                    stroke_width=stroke_width + 1,
                    stroke_fill=(0, 0, 0, 85),
                )
            # 2. 核心描边与正文字体
            draw.text(
                (x, curr_y),
                line,
                font=font,
                fill=(*text_color, 255),
                stroke_width=stroke_width,
                stroke_fill=(*stroke_color, 255),
            )
            curr_y += lh + spacing

        return Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")

    def render_vertical(
        self,
        img: Image.Image,
        columns: List[str],
        anchor: str = "top_right",
        font_size: int = 36,
        text_color: Tuple[int, int, int] = (20, 20, 25),
        stroke_color: Tuple[int, int, int] = (255, 255, 255),
        stroke_width: int = 4,
        shadow: bool = True,
        margin_x: int = 70,
        margin_y: int = 80,
    ) -> Image.Image:
        """竖排文字渲染（日漫右上/右侧心理独白、情境旁白）"""
        W, H = img.size
        font = self._get_font(font_size)
        overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        draw = ImageDraw.Draw(overlay)

        col_spacing = int(font_size * 0.45)
        char_spacing = int(font_size * 0.12)

        num_cols = len(columns)
        col_width = font_size + stroke_width * 2
        total_width = num_cols * col_width + (num_cols - 1) * col_spacing

        if anchor == "top_right":
            base_x = W - margin_x - col_width
            base_y = margin_y
        elif anchor == "top_left":
            base_x = margin_x + total_width - col_width
            base_y = margin_y
        elif anchor == "bottom_right":
            base_x = W - margin_x - col_width
            base_y = H - margin_y - 400
        else:
            base_x = W - margin_x - col_width
            base_y = margin_y

        for col_idx, col in enumerate(columns):
            # 日漫习惯：列从右向左推进
            cx = base_x - col_idx * (col_width + col_spacing)
            cy = base_y
            for ch in col:
                bbox = draw.textbbox((0, 0), ch, font=font, stroke_width=stroke_width)
                ch_w = bbox[2] - bbox[0]
                ch_h = bbox[3] - bbox[1]
                offset_x = cx + (col_width - ch_w) // 2

                # 标点符号竖排偏置
                if ch in "，。、！？":
                    offset_x += int(font_size * 0.25)
                elif ch in "……":
                    offset_x += int(font_size * 0.1)

                if shadow:
                    draw.text(
                        (offset_x + 2, cy + 2),
                        ch,
                        font=font,
                        fill=(0, 0, 0, 85),
                        stroke_width=stroke_width + 1,
                        stroke_fill=(0, 0, 0, 85),
                    )
                draw.text(
                    (offset_x, cy),
                    ch,
                    font=font,
                    fill=(*text_color, 255),
                    stroke_width=stroke_width,
                    stroke_fill=(*stroke_color, 255),
                )
                cy += ch_h + char_spacing

        return Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")

    def typeset_file(
        self,
        input_image: str,
        output_image: str,
        text_content: Union[str, List[str]],
        mode: str = "horizontal",
        anchor: str = "bottom_subtitle",
        font_size: int = 40,
        stroke_width: int = 4,
        stroke_color: str = "#FFFFFF",
        text_color: str = "#141419",
        shadow: bool = True,
    ) -> str:
        """主入口：对单个图片文件进行嵌字"""
        if os.path.realpath(input_image) == os.path.realpath(output_image):
            raise ValueError('输出不得覆盖输入图片。')
        if not os.path.exists(input_image):
            raise FileNotFoundError(f"输入图片不存在: {input_image}")

        if isinstance(text_content, str):
            lines = [l.strip() for l in text_content.split("\n") if l.strip()]
        else:
            lines = text_content

        with Image.open(input_image) as source:
            img = source.copy()
        s_rgb = hex_to_rgb(stroke_color)
        t_rgb = hex_to_rgb(text_color)

        if mode == "vertical":
            res = self.render_vertical(
                img,
                columns=lines,
                anchor=anchor,
                font_size=font_size,
                text_color=t_rgb,
                stroke_color=s_rgb,
                stroke_width=stroke_width,
                shadow=shadow,
            )
        else:
            res = self.render_horizontal(
                img,
                lines=lines,
                anchor=anchor,
                font_size=font_size,
                text_color=t_rgb,
                stroke_color=s_rgb,
                stroke_width=stroke_width,
                shadow=shadow,
            )

        os.makedirs(os.path.dirname(os.path.abspath(output_image)), exist_ok=True)
        res.save(output_image, quality=95)
        return output_image


import json
import math
from functools import lru_cache
from pathlib import Path
from fontTools.ttLib import TTFont

FONT_MANIFEST = Path(os.environ.get('LETTERING_FONT_MANIFEST') or Path(__file__).resolve().parent.parent / 'assets' / 'fonts' / 'manifest.json')


@lru_cache(maxsize=16)
def _font_cmap(path):
    font = TTFont(path, fontNumber=0, lazy=True)
    cmap = set((font.getBestCmap() or {}).keys())
    font.close()
    return cmap


_MANIFEST_CACHE = {}


def _manifest():
    """Parsed font manifest, re-read only when the file's mtime or size changes."""
    stat = FONT_MANIFEST.stat()
    stamp = (str(FONT_MANIFEST), stat.st_mtime_ns, stat.st_size)
    if _MANIFEST_CACHE.get('stamp') != stamp:
        _MANIFEST_CACHE['data'] = json.loads(FONT_MANIFEST.read_text(encoding='utf-8-sig'))
        _MANIFEST_CACHE['stamp'] = stamp
    return _MANIFEST_CACHE['data']


@lru_cache(maxsize=64)
def _truetype(path, size):
    return ImageFont.truetype(path, size)


def _font_paths(font_id, language):
    manifest = _manifest()
    selected = [manifest['styles'][font_id]] + manifest.get('fallbacks', {}).get(language, [])
    paths = []
    for key in selected:
        entry = manifest['fonts'][key]
        path = Path(entry['path'])
        if not path.is_absolute():
            path = FONT_MANIFEST.parent / path
        if path.is_file() and str(path) not in paths:
            paths.append(str(path))
    return paths


_PHRASE_END = set('。！？…～~!?')
_CLAUSE_END = set('，、；：,;')
_OPEN_PUNCT = set('（《「『【〈“‘(')
_CLOSE_PUNCT = set('，。、！？：；）》」』】〉”’～~,!?;:)♡♥❤♪')
# Ellipsis and dash runs ride with the glyph before them: never split 「……」 or start a line with 「…」.
_GLUE = set('…—.')
_WORDS = {
    '先说','晚饭','我饿','别的','等会','等会儿','再讲','事情','就是','这样','接下来','两个','星期','值班','工作','交给','居然','如此','好吧','答应',
    '我们','你们','他们','什么','怎么','为什么','可以','不是','没有','已经','现在','然后','因为','所以','如果','但是','不过','还是','或者','以及',
    '后面','你看','评价','很高','今天','晚上','明天','早上','学生','会长','一起','不要','知道','觉得','喜欢','原来','当然','真的','这个','那个','这里','那里','自己','大家',
}
def _glyph_tokens(glyphs):
    """Keep punctuation with the preceding word and do not split a known word."""
    tokens, i, count = [], 0, len(glyphs)
    while i < count:
        ch = glyphs[i][0]
        if ch == '\n':
            tokens.append(glyphs[i:i+1]); i += 1; continue
        if ch.isspace():
            i += 1; continue
        if ch in _OPEN_PUNCT or ch in _CLOSE_PUNCT:
            tokens.append(glyphs[i:i+1]); i += 1; continue
        text = ''.join(item[0] for item in glyphs[i:])
        matched = next((len(word) for size in range(min(6, count - i), 1, -1)
                        if (word := text[:size]) in _WORDS), 0)
        if not matched:
            matched = 1
            while i + matched < count:
                nxt = glyphs[i + matched][0]
                if nxt == '\n' or nxt.isspace() or nxt in _OPEN_PUNCT or nxt in _CLOSE_PUNCT or not ('\u4e00' <= nxt <= '\u9fff'):
                    break
                probe = text[:matched + 1]
                if any(word.startswith(probe) for word in _WORDS):
                    matched += 1
                else:
                    break
        end = i + matched
        while end < count and (glyphs[end][0] in _CLOSE_PUNCT or glyphs[end][0] in _GLUE):
            end += 1
        tokens.append(glyphs[i:end]); i = end
    return tokens

def _unglue_wide(tokens, width, limit):
    """A glued token wider than a whole line goes back to the old split so no line outgrows the limit."""
    for token in tokens:
        cut = next((i for i, g in enumerate(token) if g[0] in _GLUE), 0)
        if cut and width(token) > limit:
            yield token[:cut]
            yield from ([g] for g in token[cut:])
        else:
            yield token


def _wrap_glyphs(glyphs, limit, spacing):
    """Wrap at punctuation or whole words. Never split a word to fill the line."""
    def width(items):
        return sum(font.getlength(ch) + spacing for ch, font, _ in items if ch != '\n')
    lines, current = [], []
    for token in _unglue_wide(_glyph_tokens(glyphs), width, limit):
        if token and token[0][0] == '\n':
            lines.append(current); current = []; continue
        if token and token[0][0] in _CLOSE_PUNCT and current:
            current.extend(token); continue
        if current and width(current + token) > limit:
            cjk = lambda ch: '\u4e00' <= ch <= '\u9fff'
            single = len(token) == 1 or (any(g[0] in _GLUE for g in token)
                                         and all(g[0] in _GLUE or g[0] in _CLOSE_PUNCT for g in token[1:]))
            if single and current and cjk(token[0][0]) and cjk(current[-1][0]):
                token = [current.pop(), *token]
            # never break inside a punctuation run or before closing punctuation (……♡ stays together)
            split_at = max((i + 1 for i, glyph in enumerate(current) if (glyph[0] in _PHRASE_END or glyph[0] in _CLAUSE_END)
                            and (i + 1 == len(current) or current[i + 1][0] not in _CLOSE_PUNCT | _PHRASE_END | _CLAUSE_END)), default=0)
            if split_at and width(current[split_at:] + token) <= limit:
                lines.append(current[:split_at]); current = current[split_at:]
            else:
                lines.append(current); current = []
        current.extend(token)
    lines.append(current)
    if len(lines) > 1 and not lines[-1]:
        lines.pop()
    return lines


def _layer_bitmap(layer, language):
    size = layer.get('font_size', 40)
    paths = _font_paths(layer.get('font', layer.get('kind', 'dialogue')), language)
    fonts = {path: _truetype(path, size) for path in paths}
    glyphs, missing = [], []
    for ch in layer['text']:
        if ch == '\n':
            glyphs.append((ch, None, None)); continue
        path = next((p for p in paths if ord(ch) in _font_cmap(p)), None)
        if path is None:
            missing.append(f'U+{ord(ch):04X}')
        else:
            glyphs.append((ch, fonts[path], path))
    if missing:
        raise ValueError('missing_glyph: ' + ', '.join(sorted(set(missing))))
    spacing = layer.get('letter_spacing', 0)
    vertical = layer.get('mode', 'horizontal') == 'vertical'
    width_limit = layer.get('max_width', 600)
    # Keep fixed 4px white stroke and 5px offset shadow inside the measured bounds.
    pad = 8
    positions, used = [], []
    x, y = pad, pad
    line_step = math.ceil(size * 1.45) + 8
    column = 0
    max_x = max_y = 1
    line_offsets = {}
    if not vertical:
        inner = max(1, width_limit - 2 * pad)
        wrapped = _wrap_glyphs(glyphs, inner, spacing)
        glyphs = []
        for index, line in enumerate(wrapped):
            if index: glyphs.append(('\n', None, None))
            glyphs.extend(line)
            line_offsets[index] = max(0, (inner - sum(font.getlength(ch) + spacing for ch, font, _ in line if ch != '\n')) / 2)
    line_index = 0
    for ch, font, path in glyphs:
        if ch == '\n':
            if vertical:
                column += 1; x = pad + column * line_step; y = pad
            else:
                x = pad; y += line_step; line_index += 1
            continue
        bbox = font.getbbox(ch)
        advance = font.getlength(ch)
        # Horizontal glyphs share a baseline; punctuation must not jump to the
        # top just because its individual ink bounding box is shorter.
        center = 0 if vertical else line_offsets.get(line_index, 0)
        draw_x = x - bbox[0] + center
        draw_y = y - bbox[1] if vertical else y + size - font.getmetrics()[0]
        positions.append((ch, font, draw_x, draw_y))
        used.append(path)
        max_x = max(max_x, draw_x + bbox[2] + pad)
        max_y = max(max_y, draw_y + bbox[3] + pad)
        if vertical:
            y += max(size, bbox[3] - bbox[1]) + spacing + 4
        else:
            x += advance + spacing
    if not vertical:
        max_x = max(max_x, width_limit)
    bitmap = Image.new('RGBA', (math.ceil(max_x), math.ceil(max_y)), (0, 0, 0, 0))
    draw = ImageDraw.Draw(bitmap)
    color = hex_to_rgb(layer.get('color', '#000000'))
    for ch, font, x, y in positions:
        draw.text((x + 2, y + 2), ch, font=font, fill=(0, 0, 0, 85), stroke_width=5, stroke_fill=(0, 0, 0, 85))
        draw.text((x, y), ch, font=font, fill=(*color, 255), stroke_width=4, stroke_fill=(255, 255, 255, 255))
    if vertical and column:
        # Explicit newlines form columns in right-to-left order, without mirroring glyphs.
        flipped = Image.new('RGBA', bitmap.size)
        for col in range(column + 1):
            left = col * line_step
            tile = bitmap.crop((left, 0, min(left + line_step, bitmap.width), bitmap.height))
            flipped.alpha_composite(tile, (bitmap.width - min(left + line_step, bitmap.width), 0))
        bitmap = flipped
    bounds = bitmap.getbbox()
    if bounds is None:
        raise ValueError('empty_text: text has no visible glyphs')
    bitmap = bitmap.crop(bounds)
    rotation = layer.get('rotation', 0)
    if rotation:
        bitmap = bitmap.rotate(-rotation, resample=Image.Resampling.BICUBIC, expand=True)
        bitmap = bitmap.crop(bitmap.getbbox())
    return bitmap, sorted(set(used))


def _number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _paste(image, bitmap, x, y):
    """alpha_composite that accepts bitmaps partly (or wholly) outside the image."""
    left, top = max(0, x), max(0, y)
    right, bottom = min(image.width, x + bitmap.width), min(image.height, y + bitmap.height)
    if right <= left or bottom <= top:
        return
    part = bitmap.crop((left - x, top - y, right - x, bottom - y))
    image.alpha_composite(part, (left, top))


def _load_stickers(stickers):
    """Image stickers ({id, path, sha, x, y (centre), width, height, rotation, opacity, z, flip}).

    Returns ({'below': [...], 'above': [...]}, boxes, errors). Any error is fatal for the page:
    a sticker is never silently dropped from a finalized image.
    """
    import hashlib
    from PIL import ImageOps
    out, boxes, errors = {'below': [], 'above': []}, [], []
    if not isinstance(stickers, list):
        return out, boxes, [{'code': 'invalid_stickers', 'dialogue_id': None, 'detail': '贴图格式无效'}]
    for sticker in stickers:
        ident = sticker.get('id') if isinstance(sticker, dict) else None
        def fail(code, detail=None):
            errors.append({'code': code, 'dialogue_id': None, 'sticker_id': ident, 'detail': detail})
        if not isinstance(sticker, dict) or not isinstance(ident, str):
            fail('invalid_sticker', '贴图参数无效'); continue
        numbers = {'x': None, 'y': None, 'width': (1, 16384), 'height': (1, 16384), 'rotation': (-360, 360), 'opacity': (0, 1)}
        if any(not _number(sticker.get(k)) or (r and not r[0] <= sticker[k] <= r[1]) for k, r in numbers.items()):
            fail('invalid_sticker', '贴图参数无效'); continue
        if sticker.get('z') not in ('below', 'above') or not isinstance(sticker.get('flip', False), bool):
            fail('invalid_sticker', '贴图参数无效'); continue
        path = sticker.get('path')
        if not isinstance(path, str) or not Path(path).is_file():
            fail('missing_sticker', '贴图素材文件不见了：' + str(path)); continue
        data = Path(path).read_bytes()
        if sticker.get('sha') and hashlib.sha256(data).hexdigest() != sticker['sha']:
            fail('sticker_changed', '贴图素材文件内容变了：' + str(path)); continue
        import io
        with Image.open(io.BytesIO(data)) as source:
            bitmap = source.convert('RGBA')
        bitmap = bitmap.resize((max(1, round(sticker['width'])), max(1, round(sticker['height']))), Image.Resampling.LANCZOS)
        if sticker.get('flip'):
            bitmap = ImageOps.mirror(bitmap)
        if sticker['opacity'] < 1:
            alpha = bitmap.getchannel('A').point(lambda v, o=sticker['opacity']: round(v * o))
            bitmap.putalpha(alpha)
        if sticker['rotation']:
            bitmap = bitmap.rotate(-sticker['rotation'], resample=Image.Resampling.BICUBIC, expand=True)
        x = round(sticker['x'] - bitmap.width / 2)
        y = round(sticker['y'] - bitmap.height / 2)
        out[sticker['z']].append((bitmap, x, y))
        boxes.append({'id': ident, 'x': x, 'y': y, 'width': bitmap.width, 'height': bitmap.height, 'z': sticker['z']})
    return out, boxes, errors


def render_layout(input_image, output_image, layout, allow_invalid=False, layer_dir=None):
    """Render exact editable layout; invalid export never writes an output.

    x/y specify the top-left of the complete rotated ink/shadow bounding box.
    Optional speaker_ids supplies authoritative character IDs from the work store.
    """
    result = {'success': False, 'width': 0, 'height': 0, 'layers': [], 'errors': []}
    errors = result['errors']
    def error(code, dialogue_id=None, detail=None):
        errors.append({'code': code, 'dialogue_id': dialogue_id, 'detail': detail})
    try:
        if Path(input_image).resolve() == Path(output_image).resolve():
            error('input_overwrite'); return result
        if not isinstance(layout, dict) or not isinstance(layout.get('layers'), list):
            error('invalid_layout'); return result
        language = layout.get('language', 'zh')
        if language not in ('zh', 'ja', 'ko', 'en'):
            error('unsupported_language'); return result
        with Image.open(input_image) as source:
            image = source.convert('RGBA')
        result['width'], result['height'] = image.size
        regions = layout.get('regions', {})
        if not isinstance(regions, dict) or not isinstance(regions.get('protected', []), list):
            error('invalid_regions'); return result
        protected = regions.get('protected', [])
        for region in protected:
            if not isinstance(region, dict) or any(not _number(region.get(k)) for k in ('x', 'y', 'width', 'height')) or region['width'] <= 0 or region['height'] <= 0:
                error('invalid_protected_region'); return result
        speaker_ids = layout.get('speaker_ids')
        if speaker_ids is not None and (not isinstance(speaker_ids, list) or any(not isinstance(s, str) for s in speaker_ids)):
            error('invalid_speaker_ids'); return result
        seen, pending = set(), []
        for layer in layout['layers']:
            if not isinstance(layer, dict):
                error('invalid_layer'); continue
            ident = layer.get('dialogue_id')
            if not isinstance(ident, str) or not ident.strip():
                error('invalid_dialogue_id'); continue
            if ident in seen:
                error('duplicate_dialogue_id', ident); continue
            seen.add(ident)
            kind = layer.get('kind', 'dialogue')
            if kind not in ('dialogue', 'thought', 'narration', 'sfx'):
                error('invalid_kind', ident); continue
            # A missing or not-yet-bound speaker is a manual choice. It still draws and does not block approval.
            if not isinstance(layer.get('text'), str) or not layer['text'].strip():
                error('empty_text', ident); continue
            color = layer.get('color', '#000000')
            if not isinstance(color, str) or not color.startswith('#') or len(color) not in (4, 7) or any(c not in '0123456789abcdefABCDEF' for c in color[1:]):
                error('invalid_color', ident); continue
            numeric = {'x': (0, None), 'y': (0, None), 'font_size': (8, 256), 'rotation': (-360, 360), 'letter_spacing': (-4, 256), 'max_width': (16, 16384)}
            defaults = {'font_size': 40, 'rotation': 0, 'letter_spacing': 0, 'max_width': 600}
            invalid = False
            for field, (minimum, maximum) in numeric.items():
                value = layer.get(field, defaults.get(field))
                if not _number(value) or value < minimum or maximum is not None and value > maximum:
                    error('invalid_' + field, ident); invalid = True
            if not isinstance(layer.get('font_size', 40), int) or isinstance(layer.get('font_size', 40), bool):
                error('invalid_font_size', ident); invalid = True
            if layer.get('mode', 'horizontal') not in ('horizontal', 'vertical'):
                error('invalid_mode', ident); invalid = True
            if layer.get('font', kind) not in _manifest()['styles']:
                error('invalid_font', ident); invalid = True
            if not isinstance(layer.get('locked', False), bool):
                error('invalid_locked', ident); invalid = True
            if invalid: continue
            try:
                bitmap, fonts = _layer_bitmap(layer, language)
            except (ValueError, OSError, KeyError) as exc:
                error('missing_glyph' if 'missing_glyph' in str(exc) else 'font_or_text_error', ident, str(exc)); continue
            x, y = round(layer['x']), round(layer['y'])
            width, height = bitmap.size
            result['layers'].append({'dialogue_id': ident, 'x': x, 'y': y, 'width': width, 'height': height, 'fonts': fonts, 'stroke_width': 4})
            if x + width > image.width or y + height > image.height or width > layer.get('max_width', 600):
                error('overflow', ident, {'x': x, 'y': y, 'width': width, 'height': height})
            for region in protected:
                if x < region['x'] + region['width'] and x + width > region['x'] and y < region['y'] + region['height'] and y + height > region['y']:
                    error('protected_overlap', ident); break
            pending.append((bitmap, x, y, result['layers'][-1]))
        stickers = None
        if layout.get('stickers') is not None:
            stickers, boxes, sticker_errors = _load_stickers(layout['stickers'])
            if sticker_errors:
                errors.extend(sticker_errors); return result
            result['stickers'] = boxes
        if errors and not allow_invalid:
            return result
        if stickers:
            for bitmap, x, y in stickers['below']:
                _paste(image, bitmap, x, y)
        for bitmap, x, y, box in pending:
            if layer_dir is not None:
                import hashlib
                directory = Path(layer_dir).resolve()
                directory.mkdir(parents=True, exist_ok=True)
                path = directory / (hashlib.sha256(box['dialogue_id'].encode('utf8')).hexdigest()[:24] + '.png')
                if path == Path(input_image).resolve():
                    error('input_overwrite'); return result
                bitmap.save(path, format='PNG')
                box['path'] = str(path)
            image.alpha_composite(bitmap, (x, y))
        if stickers:
            for bitmap, x, y in stickers['above']:
                _paste(image, bitmap, x, y)
        Path(output_image).parent.mkdir(parents=True, exist_ok=True)
        image.convert('RGB').save(output_image, format='PNG')
        result['success'] = not errors
        result['output_path'] = str(Path(output_image).resolve())
        result['preview_invalid'] = bool(errors)
        return result
    except (OSError, ValueError, TypeError, KeyError) as exc:
        error('render_error', detail=str(exc)); return result



def main():
    sys.stdout.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser(description="DSH PS-Style Stroke Comic Typesetter")
    parser.add_argument("-i", "--input", required=True, help="输入图片路径")
    parser.add_argument("-o", "--output", required=True, help="输出图片路径")
    parser.add_argument("-t", "--text", required=False, help="嵌字内容，多行可用 \\n 分隔")
    parser.add_argument("-m", "--mode", default="horizontal", choices=["horizontal", "vertical"], help="排列方式: horizontal(横排) / vertical(竖排)")
    parser.add_argument("-a", "--anchor", default="bottom_subtitle", help="位置锚点: bottom_subtitle, top_right, top_left, bottom_left, center")
    parser.add_argument("-s", "--size", type=int, default=40, help="字体大小 (默认: 40)")
    parser.add_argument("-w", "--stroke", type=int, default=4, help="描边外扩像素 (默认: 4)")
    parser.add_argument("--stroke-color", default="#FFFFFF", help="描边颜色 Hex (默认: #FFFFFF 纯白)")
    parser.add_argument("--text-color", default="#141419", help="文字颜色 Hex (默认: #141419 深墨黑)")
    parser.add_argument("--no-shadow", action="store_true", help="关闭阴影效果")

    parser.add_argument("--layout", help="多文字图层布局 JSON 文件，与 -t 互斥")
    parser.add_argument("--allow-invalid", action="store_true", help="仅预览：保留校验错误，不允许定稿")
    parser.add_argument("--layer-dir", help="可选：保存服务端渲染的透明文字图层，用于拖动校准")
    args = parser.parse_args()
    if bool(args.layout) == bool(args.text):
        parser.error("必须且只能提供 --layout 或 -t")
    if args.layout:
        try:
            layout = json.loads(Path(args.layout).read_text(encoding="utf-8-sig"))
            result = render_layout(args.input, args.output, layout, args.allow_invalid, args.layer_dir)
        except (OSError, ValueError) as exc:
            result = {"success": False, "width": 0, "height": 0, "layers": [], "errors": [{"code": "invalid_layout", "detail": str(exc)}]}
        print(json.dumps(result, ensure_ascii=False))
        sys.exit(0 if result["success"] or args.allow_invalid and result.get("output_path") else 1)

    # 处理多行换行转义
    raw_text = args.text.replace("\\n", "\n")
    lines = [l.strip() for l in raw_text.split("\n") if l.strip()]

    typesetter = ComicTypesetter()
    out = typesetter.typeset_file(
        input_image=args.input,
        output_image=args.output,
        text_content=lines,
        mode=args.mode,
        anchor=args.anchor,
        font_size=args.size,
        stroke_width=args.stroke,
        stroke_color=args.stroke_color,
        text_color=args.text_color,
        shadow=not args.no_shadow,
    )
    print(f"[OK] 嵌字完成: {out}")

if __name__ == "__main__":
    main()

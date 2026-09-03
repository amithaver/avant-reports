#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Конвертер выгрузок Serpstat Rank Tracker в данные дашборда позиций.

Что делает
----------
Берёт один или несколько файлов `serpstat_позиции_<ГГГГ-ММ-ДД>.json`
(сырая выгрузка Rank Tracker по проекту tcsavant.com) и раскладывает их в
формат, который читает дашборд `otchety/pozicii/`:

    data/keywords.json      словарь фраз и разметки — общий для всех недель
    data/<ГГГГ-ММ-ДД>.json  позиции этой недели, только числа
    data/index.json         манифест: перечень срезов

Манифест дописывается, а не переписывается: срезы, которые в нём уже есть,
остаются на месте. Вёрстку дашборда трогать не нужно никогда.

Запуск
------
Одна новая неделя:

    python tools/serpstat_to_dashboard.py ^
      "G:\\Мой диск\\MESHKOR — Клиенты\\AVANT\\20_САЙТ_И_SEO\\25_ДАННЫЕ\\serpstat_позиции_2026-09-02.json"

Пересобрать всё с нуля:

    python tools/serpstat_to_dashboard.py "...\\serpstat_позиции_2026-08-*.json" --rebuild

Ключи
-----
  --out КАТАЛОГ   куда писать (по умолчанию otchety/pozicii/data рядом со скриптом)
  --rebuild       собрать манифест заново, а не дописать
  --label ТЕКСТ   подпись среза в интерфейсе (по умолчанию «9 августа»)
  --dry-run       посчитать и показать, ничего не записывая

Договорённости о данных, снятые с выгрузок 05–26.08.2026
--------------------------------------------------------
* `position: 0` в выгрузке означает «фразы нет в первой сотне», а не первое
  место. В дашборд такая позиция уходит как `null`. Если считать нули за
  позиции, топ-3 раздувается с 670 до 852 — вся сводка становится ложной.
* `frequency: 0` — не ошибка, таких фраз 941 из 1335. Взвешенные метрики
  просто не учитывают их веса.
* Разметка живёт в поле `tags`: `type:`, `тема:`, `яз:`, `geo:локал`.
* Посадочная страница снимается на каждом замере отдельно и может меняться
  от недели к неделе, поэтому лежит в недельном файле, а не в словаре фраз.
"""

import argparse
import glob
import json
import os
import re
import sys
from datetime import date

sys.stdout.reconfigure(encoding="utf-8")

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_OUT = os.path.normpath(os.path.join(HERE, "..", "otchety", "pozicii", "data"))

DATE_RE = re.compile(r"(\d{4}-\d{2}-\d{2})")
MONTHS = ("января", "февраля", "марта", "апреля", "мая", "июня",
          "июля", "августа", "сентября", "октября", "ноября", "декабря")

TAG_LANG, TAG_TYPE, TAG_THEME, TAG_GEO = "яз", "type", "тема", "geo"


def human_date(iso):
    y, m, d = (int(x) for x in iso.split("-"))
    return "%d %s" % (d, MONTHS[m - 1])


def slice_date(path, rows):
    """Дата среза: сначала из самих строк, потом из имени файла."""
    dates = {r.get("date") for r in rows if r.get("date")}
    if len(dates) == 1:
        return dates.pop()
    if len(dates) > 1:
        raise SystemExit("В файле %s несколько дат: %s" % (path, sorted(dates)))
    m = DATE_RE.search(os.path.basename(path))
    if not m:
        raise SystemExit("Не удалось определить дату среза для %s" % path)
    return m.group(1)


def parse_tags(tags):
    out = {"lang": "", "type": "", "theme": "", "local": 0}
    for t in tags or []:
        prefix, _, value = t.partition(":")
        if prefix == TAG_LANG:
            out["lang"] = value
        elif prefix == TAG_TYPE:
            out["type"] = value
        elif prefix == TAG_THEME:
            out["theme"] = value
        elif prefix == TAG_GEO and value == "локал":
            out["local"] = 1
    return out


def short_url(url):
    """https://tcsavant.com/ru/kursy/ -> /ru/kursy/ ; пусто -> ''"""
    if not url:
        return ""
    u = re.sub(r"^https?://[^/]+", "", url.strip())
    return u or "/"


def encode_dict(values):
    """Список значений -> {"dict": уникальные, "idx": индексы}. Экономит вес."""
    order, index = [], {}
    idx = []
    for v in values:
        if v not in index:
            index[v] = len(order)
            order.append(v)
        idx.append(index[v])
    return {"dict": order, "idx": idx}


def read_slice(path):
    with open(path, encoding="utf-8") as f:
        rows = json.load(f)
    if not isinstance(rows, list) or not rows:
        raise SystemExit("Ожидался непустой массив строк: %s" % path)
    return rows


def build(paths, out_dir, rebuild=False, labels=None, dry_run=False):
    labels = labels or {}
    slices = []            # [(iso, rows)]
    for p in paths:
        rows = read_slice(p)
        slices.append((slice_date(p, rows), rows, p))
    slices.sort(key=lambda s: s[0])

    # --- словарь фраз: собираем по всем поданным срезам, свежий побеждает ---
    kw_path = os.path.join(out_dir, "keywords.json")
    known = {}
    if os.path.exists(kw_path) and not rebuild:
        old = json.load(open(kw_path, encoding="utf-8"))
        for i, kid in enumerate(old["ids"]):
            known[kid] = {
                "kw": old["kw"][i],
                "lang": old["lang"]["dict"][old["lang"]["idx"][i]],
                "type": old["type"]["dict"][old["type"]["idx"][i]],
                "theme": old["theme"]["dict"][old["theme"]["idx"][i]],
                "local": old["local"][i],
                "vol": old["vol"][i],
            }

    for iso, rows, _ in slices:
        for r in rows:
            kid = r["keyword_id"]
            tags = parse_tags(r.get("tags"))
            known[kid] = {
                "kw": r["value"],
                "lang": tags["lang"],
                "type": tags["type"],
                "theme": tags["theme"],
                "local": tags["local"],
                "vol": r.get("frequency") or 0,
            }

    ids = sorted(known, key=lambda k: known[k]["kw"].lower())
    keywords = {
        "version": 1,
        "generated": date.today().isoformat(),
        "count": len(ids),
        "ids": ids,
        "kw": [known[k]["kw"] for k in ids],
        "lang": encode_dict([known[k]["lang"] for k in ids]),
        "type": encode_dict([known[k]["type"] for k in ids]),
        "theme": encode_dict([known[k]["theme"] for k in ids]),
        "local": [known[k]["local"] for k in ids],
        "vol": [known[k]["vol"] for k in ids],
    }
    pos_of = {kid: i for i, kid in enumerate(ids)}

    # --- недельные файлы ---
    written = []
    for iso, rows, src in slices:
        positions = [None] * len(ids)
        urls = [""] * len(ids)
        ranked = 0
        for r in rows:
            i = pos_of[r["keyword_id"]]
            p = r.get("position")
            # 0 и None одинаково означают «не в первой сотне»
            if p:
                positions[i] = p
                ranked += 1
            urls[i] = short_url(r.get("url"))
        payload = {
            "date": iso,
            "count": len(ids),
            "ranked": ranked,
            "pos": positions,
            "url": encode_dict(urls),
        }
        fname = "%s.json" % iso
        written.append((iso, fname, len(rows), ranked, src))
        if not dry_run:
            write_json(os.path.join(out_dir, fname), payload)

    # --- манифест ---
    idx_path = os.path.join(out_dir, "index.json")
    manifest = {
        "project": "tcsavant.com",
        "region": "Украина",
        "source": "Serpstat Rank Tracker, проект 1321152",
        "keywords": "keywords.json",
        "slices": [],
    }
    if os.path.exists(idx_path) and not rebuild:
        manifest.update(json.load(open(idx_path, encoding="utf-8")))
    by_date = {s["date"]: s for s in manifest.get("slices", [])}
    for iso, fname, total, ranked, _src in written:
        by_date[iso] = {
            "date": iso,
            "file": fname,
            "label": labels.get(iso) or human_date(iso),
            "partial": ranked < total * 0.5,
        }
    manifest["slices"] = [by_date[d] for d in sorted(by_date)]

    if not dry_run:
        write_json(kw_path, keywords)
        write_json(idx_path, manifest)

    # --- отчёт в консоль ---
    print("Фраз в словаре: %d" % len(ids))
    for iso, fname, total, ranked, src in written:
        flag = "  ← НЕПОЛНЫЙ, за базу не брать" if ranked < total * 0.5 else ""
        print("  %s  строк %-5d  с позицией %-5d  %s%s"
              % (iso, total, ranked, fname, flag))
    print("Срезов в манифесте: %d" % len(manifest["slices"]))
    if dry_run:
        print("(--dry-run: ничего не записано)")
    else:
        print("Записано в %s" % out_dir)


def write_json(path, obj):
    """Пишем через временный файл: сбой на записи не рвёт готовые данные."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, path)


def main():
    ap = argparse.ArgumentParser(
        description="Serpstat Rank Tracker -> данные дашборда позиций")
    ap.add_argument("paths", nargs="+",
                    help="файлы serpstat_позиции_<дата>.json, маски допускаются")
    ap.add_argument("--out", default=DEFAULT_OUT, help="каталог data/")
    ap.add_argument("--rebuild", action="store_true",
                    help="собрать словарь и манифест заново")
    ap.add_argument("--label", action="append", default=[],
                    metavar="ДАТА=ПОДПИСЬ", help="подпись среза в интерфейсе")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    paths = []
    for p in a.paths:
        hits = glob.glob(p)
        if not hits:
            raise SystemExit("Не найдено: %s" % p)
        paths.extend(hits)

    labels = {}
    for item in a.label:
        k, _, v = item.partition("=")
        labels[k.strip()] = v.strip()

    build(sorted(set(paths)), a.out, a.rebuild, labels, a.dry_run)


if __name__ == "__main__":
    main()

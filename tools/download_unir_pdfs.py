#!/usr/bin/env python3
"""Download UNIR schedule PDFs for a specific lot."""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib import error, request

API_URL = "https://paragens.amp.pt/acarto2/getcarreiras?idop={ut}"
PDF_URL = "https://paragens.amp.pt/web/horarios_pdf/schedules/{ut}/{code}.pdf"
USER_AGENT = "MetroHorario/1.0 (+https://github.com/joaoaz/MetroPorto)"


@dataclass
class PdfStatus:
    exists: bool
    status_code: int | None
    content_length: int | None
    last_modified: str | None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Download official UNIR schedule PDFs for one lot."
    )
    parser.add_argument(
        "--ut",
        required=True,
        help="Lot number or identifier, for example 3 or UT3.",
    )
    parser.add_argument(
        "--output-dir",
        default="pdfs/unir",
        help="Base output directory. Default: %(default)s",
    )
    parser.add_argument(
        "--skip-existing",
        action="store_true",
        help="Keep already downloaded PDFs instead of downloading again.",
    )
    return parser.parse_args()


def normalize_ut(value: str) -> str:
    text = value.strip().upper()
    if text.startswith("UT"):
        text = text[2:]
    if not text.isdigit():
        raise ValueError(f"Lote invalido: {value!r}")
    number = int(text, 10)
    if number < 1 or number > 5:
        raise ValueError(f"Lote fora do intervalo suportado (1-5): {value!r}")
    return f"UT{number}"


def http_request(url: str, method: str = "GET") -> Any:
    req = request.Request(url, headers={"User-Agent": USER_AGENT}, method=method)
    return request.urlopen(req, timeout=30)


def fetch_lines(ut: str) -> list[dict[str, Any]]:
    api_url = API_URL.format(ut=ut)
    with http_request(api_url) as response:
        payload = response.read().decode("utf-8")
    lines = json.loads(payload)
    if not isinstance(lines, list):
        raise RuntimeError(f"Resposta inesperada da API para {ut}")
    return lines


def check_pdf(url: str) -> PdfStatus:
    try:
        with http_request(url, method="HEAD") as response:
            headers = response.info()
            return PdfStatus(
                exists=True,
                status_code=getattr(response, "status", 200),
                content_length=parse_int_header(headers.get("Content-Length")),
                last_modified=headers.get("Last-Modified"),
            )
    except error.HTTPError as exc:
        if exc.code == 405:
            with http_request(url, method="GET") as response:
                headers = response.info()
                return PdfStatus(
                    exists=True,
                    status_code=getattr(response, "status", 200),
                    content_length=parse_int_header(headers.get("Content-Length")),
                    last_modified=headers.get("Last-Modified"),
                )
        if exc.code == 404:
            return PdfStatus(
                exists=False,
                status_code=404,
                content_length=None,
                last_modified=None,
            )
        raise


def parse_int_header(value: str | None) -> int | None:
    if value is None:
        return None
    try:
        return int(value, 10)
    except ValueError:
        return None


def download_file(url: str, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with http_request(url) as response, destination.open("wb") as handle:
        while True:
            chunk = response.read(1024 * 64)
            if not chunk:
                break
            handle.write(chunk)


def main() -> int:
    args = parse_args()
    try:
        ut = normalize_ut(args.ut)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 2

    base_dir = Path(args.output_dir)
    ut_dir = base_dir / ut
    ut_dir.mkdir(parents=True, exist_ok=True)

    lines = fetch_lines(ut)
    results: list[dict[str, Any]] = []
    downloaded = 0
    missing = 0

    for line in lines:
        code = str(line["codamp"])
        pdf_url = PDF_URL.format(ut=ut, code=code)
        pdf_name = f"{code}.pdf"
        pdf_path = ut_dir / pdf_name
        status = check_pdf(pdf_url)

        record = {
            "idcarr": line.get("idcarr"),
            "codamp": line.get("codamp"),
            "mun": line.get("mun"),
            "ut": line.get("ut"),
            "tipo": line.get("tipo"),
            "designa": line.get("designa"),
            "pdfUrl": pdf_url,
            "pdfFile": pdf_name,
            "exists": status.exists,
            "statusCode": status.status_code,
            "contentLength": status.content_length,
            "lastModified": status.last_modified,
        }

        if status.exists:
            if not (args.skip_existing and pdf_path.exists()):
                download_file(pdf_url, pdf_path)
            downloaded += 1
            print(f"[ok] {ut} {code} -> {pdf_path}")
        else:
            missing += 1
            print(f"[missing] {ut} {code} -> {pdf_url}")

        results.append(record)

    index_path = ut_dir / "index.json"
    index_path.write_text(
        json.dumps(
            {
                "generatedAt": datetime.now(timezone.utc).isoformat(),
                "sourceApi": API_URL.format(ut=ut),
                "pdfBasePattern": PDF_URL.format(ut=ut, code="{codamp}"),
                "ut": ut,
                "lineCount": len(lines),
                "downloadedCount": downloaded,
                "missingCount": missing,
                "lines": results,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    print()
    print(
        f"Saved {downloaded} PDFs for {ut} in {ut_dir} "
        f"({missing} missing, index: {index_path})."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

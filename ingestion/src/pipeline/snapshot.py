"""
Save raw bytes to R2 before parsing.

Every successful fetch lands in R2 under a deterministic key. The DB row that
results from parsing references this key in its `raw_key` column. Parser
changes are always replayable.
"""

from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone
from typing import Optional

import boto3
from botocore.client import Config


def _s3_client():
    return boto3.client(
        "s3",
        endpoint_url=os.environ["R2_ENDPOINT"],
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        config=Config(signature_version="s3v4"),
        region_name="auto",
    )


def save_raw(
    source: str,
    body: bytes,
    *,
    ext: str = "bin",
    content_type: Optional[str] = None,
    ts: Optional[datetime] = None,
) -> str:
    """
    Upload raw bytes to R2 and return the key.

    Key layout: raw/{source}/{yyyy}/{mm}/{dd}/{HHMM}-{uuid}.{ext}
    """
    bucket = os.environ.get("R2_BUCKET", "islagrid-raw")
    now = ts or datetime.now(timezone.utc)
    key = (
        f"raw/{source}/"
        f"{now:%Y/%m/%d}/"
        f"{now:%H%M}-{uuid.uuid4().hex[:8]}.{ext}"
    )

    extra: dict[str, str] = {}
    if content_type:
        extra["ContentType"] = content_type

    _s3_client().put_object(Bucket=bucket, Key=key, Body=body, **extra)
    return key

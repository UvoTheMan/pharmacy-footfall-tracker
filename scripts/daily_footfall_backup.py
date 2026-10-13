#!/usr/bin/env python3
"""Build daily branch CSVs from Supabase; email only when explicitly requested."""
import csv
import io
import json
import os
import smtplib
import ssl
import sys
from datetime import datetime, timedelta
from email.message import EmailMessage
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

BRANCHES = [("gbagada", "Gbagada"), ("akoka", "Akoka"), ("sangotedo", "Sangotedo")]
COLUMNS = ["id", "branch_id", "branch_name", "visit_date", "recorded_at", "outcome",
           "reason", "unavailable_item_requested", "batch_id", "created_by", "created_at", "updated_at"]


def env(name):
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required environment setting: {name}")
    return value


def get_json(url, key):
    req = Request(url, headers={"apikey": key, "Authorization": f"Bearer {key}",
                                "Accept": "application/json"})
    with urlopen(req, timeout=45) as response:
        return json.loads(response.read().decode("utf-8"))


def make_csv(rows):
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=COLUMNS, extrasaction="ignore",
                            lineterminator="\r\n")
    writer.writeheader()
    writer.writerows(rows)
    return ("\ufeff" + output.getvalue()).encode("utf-8")


def main():
    base = env("SUPABASE_URL").rstrip("/")
    key = env("SUPABASE_SERVICE_ROLE_KEY")
    date = os.environ.get("BACKUP_DATE", "").strip()
    start_date = os.environ.get("BACKUP_START_DATE", "").strip()
    end_date = os.environ.get("BACKUP_END_DATE", "").strip()
    weekly_report = os.environ.get("BACKUP_WEEKLY_REPORT", "").lower() == "true"
    if weekly_report and not date and not start_date and not end_date:
        today = datetime.now(ZoneInfo("Africa/Lagos")).date()
        current_monday = today - timedelta(days=today.weekday())
        start_date = (current_monday - timedelta(days=7)).isoformat()
        end_date = (current_monday - timedelta(days=1)).isoformat()
    else:
        if not date:
            date = datetime.now(ZoneInfo("Africa/Lagos")).date().isoformat()
        start_date = start_date or date
        end_date = end_date or date

    report_scope = os.environ.get("BACKUP_REPORT_SCOPE", "all").strip().lower() or "all"
    valid_scopes = {"all", *(slug for slug, _ in BRANCHES)}
    if report_scope not in valid_scopes:
        raise RuntimeError("Report scope must be all or one valid branch slug.")
    try:
        for value in (start_date, end_date):
            parsed = datetime.strptime(value, "%Y-%m-%d")
            if parsed.strftime("%Y-%m-%d") != value:
                raise ValueError
        if start_date > end_date:
            raise ValueError
    except ValueError as exc:
        raise RuntimeError("Backup start/end dates must be valid YYYY-MM-DD dates, with start no later than end.") from exc
    period_label = start_date if start_date == end_date else f"{start_date}_to_{end_date}"

    branches = get_json(f"{base}/rest/v1/branches?select=id,slug,name", key)
    by_id = {item["id"]: item for item in branches}
    missing = [slug for slug, _ in BRANCHES if not any(b.get("slug") == slug for b in branches)]
    if missing:
        raise RuntimeError("Expected branches missing: " + ", ".join(missing))

    visits = []
    offset = 0
    while True:
        params = urlencode({
            "select": "id,branch_id,visit_date,recorded_at,outcome,reason,unavailable_item_requested,batch_id,created_by,created_at,updated_at",
            "and": f"(visit_date.gte.{start_date},visit_date.lte.{end_date})", "order": "visit_date.asc,recorded_at.asc,id.asc",
            "limit": "1000", "offset": str(offset),
        })
        page = get_json(f"{base}/rest/v1/visits?{params}", key)
        if not isinstance(page, list):
            raise RuntimeError("Unexpected Supabase visits response.")
        for item in page:
            item["branch_name"] = by_id.get(item.get("branch_id"), {}).get("name", "Unknown")
        visits.extend(page)
        if len(page) < 1000:
            break
        offset += 1000

    if report_scope != "all":
        visits = [v for v in visits if by_id.get(v.get("branch_id"), {}).get("slug") == report_scope]
    selected_branches = BRANCHES if report_scope == "all" else [item for item in BRANCHES if item[0] == report_scope]

    attachments = []
    counts = {}
    output_dir = Path("backup-output")
    output_dir.mkdir(parents=True, exist_ok=True)
    for slug, _name in selected_branches:
        selected = [v for v in visits if by_id.get(v.get("branch_id"), {}).get("slug") == slug]
        filename = f"footfall_{slug}_{period_label}.csv"
        content = make_csv(selected)
        (output_dir / filename).write_bytes(content)
        attachments.append((filename, content))
        counts[filename] = len(selected)
    if report_scope == "all":
        combined = f"footfall_combined_{period_label}.csv"
        combined_content = make_csv(visits)
        (output_dir / combined).write_bytes(combined_content)
        attachments.append((combined, combined_content))
        counts[combined] = len(visits)

    branch_total = sum(counts[f"footfall_{slug}_{period_label}.csv"] for slug, _ in selected_branches)
    if branch_total != len(visits):
        raise RuntimeError("Branch counts do not match combined count; refusing to continue.")

    print(json.dumps({"start_date": start_date, "end_date": end_date, "total_visits": len(visits), "reports": counts}, indent=2))
    print(f"Generated {len(attachments)} CSV file(s) in backup-output for scope {report_scope}.")
    if os.environ.get("SEND_BACKUP_EMAIL", "").lower() != "true":
        print("Dry run: no email sent.")
        return

    sender = env("SMTP_USERNAME")
    password = env("SMTP_APP_PASSWORD").replace(" ", "")
    recipients = list(dict.fromkeys(a.strip() for a in env("BACKUP_RECIPIENTS").split(",") if a.strip()))
    if not recipients or any("@" not in address for address in recipients):
        raise RuntimeError("Configure valid comma-separated recipient email addresses.")

    msg = EmailMessage()
    msg["From"] = sender
    msg["To"] = ", ".join(recipients)
    scope_label = "all branches and combined report" if report_scope == "all" else f"{report_scope.title()} branch only"
    msg["Subject"] = f"Footlytics CSV backup - {period_label}"
    msg.set_content(f"Attached are the Footlytics CSV report(s) for {scope_label}, covering Lagos dates {start_date} through {end_date}. Total visits in this scope: {len(visits)}.")
    for filename, content in attachments:
        msg.add_attachment(content, maintype="text", subtype="csv", filename=filename)
    smtp_context = ssl.create_default_context()
    stage = "connecting to Gmail SMTP over SSL (port 465)"
    try:
        with smtplib.SMTP_SSL("smtp.gmail.com", 465, context=smtp_context, timeout=45) as smtp:
            stage = "authenticating with Gmail over SSL (port 465)"
            smtp.login(sender, password)
            stage = "sending the email via Gmail SMTP"
            smtp.send_message(msg)
    except Exception as ssl_error:
        if stage == "sending the email via Gmail SMTP":
            raise RuntimeError(
                f"{stage} failed: {ssl_error}. Delivery may be uncertain; check the recipient inbox before retrying."
            ) from ssl_error
        print(
            f"Gmail SMTP SSL attempt failed during {stage}: {ssl_error}. "
            "Trying STARTTLS on port 587.",
            file=sys.stderr,
        )
        starttls_stage = "connecting to Gmail SMTP (port 587)"
        try:
            with smtplib.SMTP("smtp.gmail.com", 587, timeout=45) as smtp:
                smtp.ehlo()
                starttls_stage = "starting TLS encryption on port 587"
                smtp.starttls(context=smtp_context)
                smtp.ehlo()
                starttls_stage = "authenticating with Gmail over STARTTLS (port 587)"
                smtp.login(sender, password)
                starttls_stage = "sending the email via Gmail SMTP"
                smtp.send_message(msg)
        except Exception as starttls_error:
            raise RuntimeError(
                f"Gmail email failed. SSL/465 failed during {stage}: {ssl_error}; "
                f"STARTTLS/587 failed during {starttls_stage}: {starttls_error}"
            ) from starttls_error
    print("Backup email sent successfully.")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Backup failed: {error}", file=sys.stderr)
        sys.exit(1)

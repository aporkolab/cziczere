"""Configure and start a local Cziczere installation with Docker Compose."""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.request import urlopen


ROOT = Path(__file__).resolve().parent
STATE = ROOT / ".cziczere"
SETTINGS = STATE / "settings.json"
PUBLIC_CONFIG = STATE / "public" / "firebase-config.json"
WEB_FIELDS = ("projectId", "apiKey", "authDomain", "appId", "messagingSenderId", "storageBucket")
PROJECT_ID = re.compile(r"[a-z][a-z0-9-]{4,28}[a-z0-9]")


def read_json(path):
    with path.open(encoding="utf-8-sig") as source:
        return json.load(source)


def write_json(path, data, mode):
    # Atomic replacement also lets a running frontend see the new public config.
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as out:
            json.dump(data, out, indent=2)
            out.write("\n")
        temporary.chmod(mode)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def web_config(source):
    if PROJECT_ID.fullmatch(source):
        url = f"https://{source}.firebaseapp.com/__/firebase/init.json"
        try:
            with urlopen(url, timeout=10) as response:
                data = json.load(response)
        except (OSError, ValueError) as error:
            raise ValueError("Firebase Hosting config unavailable. Use --firebase with a web SDK JSON file (see README).") from error
    else:
        data = read_json(Path(source).expanduser())

    if isinstance(data, dict) and isinstance(data.get("result"), dict):
        data = data["result"].get("sdkConfig")  # firebase apps:sdkconfig --json
    if not isinstance(data, dict) or not all(isinstance(data.get(k), str) and data[k].strip() for k in WEB_FIELDS):
        raise ValueError("Expected Firebase web SDK JSON containing " + ", ".join(WEB_FIELDS))
    if not PROJECT_ID.fullmatch(data["projectId"]) or (PROJECT_ID.fullmatch(source) and data["projectId"] != source):
        raise ValueError("Unexpected Firebase project ID in web configuration.")
    # Only these public SDK fields can reach the browser.
    return {key: data[key] for key in WEB_FIELDS}


def credential_path(supplied):
    platform_dir = Path(os.environ["APPDATA"]) if os.name == "nt" else Path.home() / ".config"
    config_dir = Path(os.getenv("CLOUDSDK_CONFIG") or platform_dir / "gcloud")
    adc = config_dir / "application_default_credentials.json"
    source = supplied or os.getenv("GOOGLE_APPLICATION_CREDENTIALS") or (str(adc) if adc.is_file() else None)
    if not source:
        source = input("Path to Google application credentials JSON: ").strip()
    path = Path(source).expanduser().resolve(strict=True)
    credentials = read_json(path)
    fields = {
        "authorized_user": ("client_id", "client_secret", "refresh_token"),
        "service_account": ("client_email", "private_key", "project_id"),
    }
    required = fields.get(credentials.get("type")) if isinstance(credentials, dict) else None
    if not required or not all(isinstance(credentials.get(k), str) and credentials[k].strip() for k in required):
        raise ValueError("Expected Google user ADC or service-account JSON for the backend.")
    return str(path)


def launch(args):
    if not shutil.which("docker"):
        raise ValueError("Install Docker with Compose v2 and start the Docker engine, then rerun this command.")
    subprocess.run(["docker", "compose", "version"], check=True)
    subprocess.run(["docker", "info", "--format", "{{.ServerVersion}}"], check=True)

    saved = read_json(SETTINGS) if SETTINGS.is_file() else {}
    if args.firebase or not saved:
        source = args.firebase or input("Firebase project ID or path to web SDK JSON: ").strip()
        firebase = web_config(source)
    else:
        firebase = saved["firebase"]
    adc_path = credential_path(args.credentials or saved.get("credentials"))
    settings = {"firebase": firebase, "credentials": adc_path}
    if settings != saved:
        write_json(SETTINGS, settings, 0o600)
    # Rebuild this view even after an interrupted setup; never serialize credentials into it.
    write_json(PUBLIC_CONFIG, {key: firebase[key] for key in WEB_FIELDS}, 0o644)

    env = dict(os.environ, CZ_PROJECT_ID=firebase["projectId"],
               CZ_STORAGE_BUCKET=firebase["storageBucket"], CZ_ADC_PATH=adc_path)
    subprocess.run(["docker", "compose", "up", "--build", "--detach", "--wait"],
                   cwd=ROOT, env=env, check=True)
    print(f"Open http://localhost:{env.get('CZ_PORT') or '4200'} to visit your garden.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--firebase", help="Firebase project ID or path to web SDK JSON")
    parser.add_argument("--credentials", help="path to a Google ADC or service-account JSON file")
    try:
        launch(parser.parse_args())
    except subprocess.CalledProcessError as error:
        sys.exit(error.returncode)
    except (OSError, ValueError, KeyError, EOFError) as error:
        sys.exit(f"Setup failed: {error}")

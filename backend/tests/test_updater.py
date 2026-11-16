"""Automatic updates: only a release signed with the build's key is downloaded and staged; a
tampered or unsigned one is refused; nothing is installed outside the Windows package."""

import base64
import io
import json
import zipfile

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from app import updater
from app.updater import Updater, is_newer, safe_extract, swap_script, version_key


def test_versions():
    assert version_key("v1.0.57") == (1, 0, 57) and version_key("junk") == ()
    assert is_newer("v1.0.57", "1.0.9") and not is_newer("1.0.9", "1.0.57")
    assert not is_newer("v1.0.0", "1.0.0") and not is_newer("garbage", "1.0.0")


def _zip(files: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, data in files.items():
            zf.writestr(name, data)
    return buf.getvalue()


@pytest.fixture
def signing(tmp_path, monkeypatch):
    key = Ed25519PrivateKey.generate()  # a test key, made here: never the real one
    pub = key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    key_file = tmp_path / "update_key.pub"
    key_file.write_text(base64.b64encode(pub).decode())
    monkeypatch.setattr(updater, "KEY_FILE", key_file)
    monkeypatch.setattr(updater, "__version__", "1.0.5")
    return key


def _github(release_zip: bytes, signature: bytes, tag="v1.0.9"):
    zip_url = "https://github.com/x/releases/download/v1.0.9/LabourEntryTool-windows.zip"
    files = {
        updater.LATEST: json.dumps({"tag_name": tag, "body": "## What is new\n- faster",
                                    "assets": [{"name": updater.ZIP_NAME, "browser_download_url": zip_url},
                                               {"name": updater.ZIP_NAME + ".sig",
                                                "browser_download_url": zip_url + ".sig"}]}).encode(),
        zip_url: release_zip,
        zip_url + ".sig": base64.b64encode(signature),
    }  # fmt: skip
    asked = []

    def fetch(url, limit):
        asked.append(url)
        return files[url]

    return fetch, asked


def test_a_signed_release_is_downloaded_verified_and_staged(tmp_path, signing):
    data = _zip({"LabourEntryTool/LabourEntryTool.exe": b"exe", "LabourEntryTool/_internal/x": b"1"})
    fetch, asked = _github(data, signing.sign(data))
    u = Updater(tmp_path / "updates", fetch=fetch)
    state = u.check()
    assert state.state == "ready" and state.latest == "1.0.9" and "faster" in state.notes
    ready = u.ready()
    assert ready["version"] == "1.0.9" and (tmp_path / "updates/1.0.9/LabourEntryTool/LabourEntryTool.exe").exists()
    assert all(a.startswith("https://") for a in asked)
    assert u.install() is False  # not the Windows package here: nothing is swapped


def test_a_tampered_release_is_refused_and_nothing_is_kept(tmp_path, signing):
    data = _zip({"LabourEntryTool/LabourEntryTool.exe": b"exe"})
    bad = _zip({"LabourEntryTool/LabourEntryTool.exe": b"evil"})
    fetch, _ = _github(bad, signing.sign(data))  # signature of another file
    u = Updater(tmp_path / "updates", fetch=fetch)
    state = u.check()
    assert state.state == "error" and "signature" in state.error
    assert u.ready() is None and not (tmp_path / "updates/1.0.9").exists()


def test_signed_with_another_key_is_refused(tmp_path, signing):
    data = _zip({"LabourEntryTool/LabourEntryTool.exe": b"exe"})
    fetch, _ = _github(data, Ed25519PrivateKey.generate().sign(data))
    assert Updater(tmp_path / "updates", fetch=fetch).check().state == "error"


def test_no_signing_key_means_updates_off(tmp_path, monkeypatch):
    monkeypatch.setattr(updater, "KEY_FILE", tmp_path / "missing.pub")
    asked = []
    u = Updater(tmp_path / "updates", fetch=lambda url, limit: asked.append(url))
    assert u.state.state == "off" and u.check().state == "off" and asked == []  # never asks GitHub


def test_up_to_date_and_older(tmp_path, signing):
    fetch, asked = _github(b"", b"", tag="v1.0.5")
    u = Updater(tmp_path / "updates", fetch=fetch)
    assert u.check().state == "up_to_date" and asked == [updater.LATEST]  # nothing downloaded


def test_zip_slip_is_refused(tmp_path):
    data = _zip({"../outside.txt": b"x"})
    with zipfile.ZipFile(io.BytesIO(data)) as zf, pytest.raises(ValueError):
        safe_extract(zf, tmp_path / "dest")
    assert not (tmp_path / "outside.txt").exists()


def test_only_github_downloads(tmp_path, signing):
    data = _zip({"LabourEntryTool/LabourEntryTool.exe": b"exe"})
    fetch, _ = _github(data, signing.sign(data))

    def elsewhere(url, limit):
        if url == updater.LATEST:
            return json.dumps({"tag_name": "v1.0.9", "assets": [
                {"name": updater.ZIP_NAME, "browser_download_url": "https://evil.example/x.zip"},
                {"name": updater.ZIP_NAME + ".sig", "browser_download_url": "https://evil.example/x.sig"}]}).encode()
        raise AssertionError("must not download from there")

    state = Updater(tmp_path / "updates", fetch=elsewhere).check()
    assert state.state == "error" and "unexpected place" in state.error


def test_automatic_switch_is_remembered(tmp_path, signing):
    Updater(tmp_path / "updates").set_auto(False)
    assert Updater(tmp_path / "updates").state.auto is False


def test_swap_script_keeps_the_old_version_and_the_config(tmp_path):
    text = swap_script(tmp_path / "LabourEntryTool", tmp_path / "new", 1234, True, tmp_path / "ready.json")
    assert "LabourEntryTool.previous" in text and "config.yaml" in text and "1234" in text
    assert 'move "%PREV%" "%APP%"' in text  # the old one goes back if the new one cannot move in
    assert "Labour Entry Tool" not in text.split("\r\n", 2)[2].split("set")[0]  # data folder untouched


def test_release_signing_script_matches_the_updater(tmp_path, monkeypatch):
    """scripts/sign_update.py (the build) and the updater (the PC) agree: public key and signature."""
    import importlib.util
    import sys
    from pathlib import Path

    spec = importlib.util.spec_from_file_location(
        "sign_update", Path(__file__).parents[2] / "scripts" / "sign_update.py"
    )
    sign = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(sign)
    raw = Ed25519PrivateKey.generate().private_bytes(
        serialization.Encoding.Raw, serialization.PrivateFormat.Raw, serialization.NoEncryption()
    )
    monkeypatch.setenv("UPDATE_SIGNING_KEY", base64.b64encode(raw).decode())
    pub, zip_path = tmp_path / "update_key.pub", tmp_path / "LabourEntryTool-windows.zip"
    zip_path.write_bytes(_zip({"LabourEntryTool/LabourEntryTool.exe": b"exe"}))
    sign.main(["public", str(pub)])
    sign.main(["sign", str(zip_path)])
    monkeypatch.setattr(updater, "KEY_FILE", pub)
    sig = base64.b64decode(Path(f"{zip_path}.sig").read_text())
    assert updater.verify(zip_path.read_bytes(), sig, updater.public_key())
    monkeypatch.delenv("UPDATE_SIGNING_KEY")
    with pytest.raises(SystemExit) as stop:
        sign.main(["sign", str(zip_path)])
    assert stop.value.code == 3 and sys.modules  # no key: says so, the build goes on unsigned

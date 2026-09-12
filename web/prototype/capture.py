#!/usr/bin/env python3
"""Capture screenshots and run browser acceptance checks on GB10 Firefox."""
from pathlib import Path
import base64
import json
import os
import signal
import subprocess
import time
import urllib.request

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "screenshots"
PORT = 4173
DRIVER_PORT = 4447
BASE = f"http://127.0.0.1:{PORT}/"
DRIVER = f"http://127.0.0.1:{DRIVER_PORT}"
SHOTS = {
    "incident-inbox.png": "#/incidents?incident=INC-2048&rail=preview",
    "incident-detail.png": "#/incidents/INC-2048?incident=INC-2048&rail=assist&assistState=ready",
    "floor.png": "#/floor?asset=RPP1&incident=INC-2048&rail=preview",
    "asset-360.png": "#/assets/RPP1",
    "intelligence.png": "#/intelligence?run=RUN-8821",
    "maintenance-assist.png": "#/incidents/INC-2048?incident=INC-2048&rail=assist&assistState=answered",
    "evidence-viewer.png": "#/incidents/INC-2048?incident=INC-2048&rail=evidence&evidence=manual&returnRail=assist",
}

def request(method, path, payload=None):
    body = None if payload is None else json.dumps(payload).encode()
    req = urllib.request.Request(DRIVER + path, data=body, method=method, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as response:
        return json.load(response)

def execute(session, script, *args):
    return request("POST", f"/session/{session}/execute/sync", {"script": script, "args": list(args)})["value"]

def wait_for(url):
    for _ in range(80):
        try:
            urllib.request.urlopen(url, timeout=.25).close()
            return
        except OSError:
            time.sleep(.1)
    raise RuntimeError(f"service did not start: {url}")

def set_viewport(session, width, height):
    request("POST", f"/session/{session}/window/rect", {"width": width, "height": height, "x": 0, "y": 0})
    size = execute(session, "return {iw:innerWidth,ih:innerHeight,ow:outerWidth,oh:outerHeight}")
    request("POST", f"/session/{session}/window/rect", {"width": width + (width - size["iw"]), "height": height + (height - size["ih"]), "x": 0, "y": 0})
    actual = execute(session, "return {width:innerWidth,height:innerHeight}")
    if actual != {"width": width, "height": height}:
        raise RuntimeError(f"viewport mismatch: wanted {width}x{height}, got {actual}")

def navigate(session, route):
    request("POST", f"/session/{session}/url", {"url": BASE + route})
    time.sleep(.25)

def verify_view(session, name):
    checks = execute(session, "const p=document.querySelector('.page');const r=document.querySelector('.rail-body');const ids=[...document.querySelectorAll('[id]')].map(x=>x.id);return {title:document.title,app:document.querySelector('#app').children.length,scrollWidth:document.documentElement.scrollWidth,viewport:innerWidth,heading:document.querySelector('h1')?.textContent,rail:document.querySelector('[data-overlay-rail]')?.getAttribute('aria-label')||null,pageClient:[p?.clientWidth,p?.clientHeight],pageScroll:[p?.scrollWidth,p?.scrollHeight],railClient:r?[r.clientWidth,r.clientHeight]:null,railScroll:r?[r.scrollWidth,r.scrollHeight]:null,unnamed:[...document.querySelectorAll('button')].filter(b=>!b.innerText.trim()&&!b.getAttribute('aria-label')).length,duplicateIds:ids.filter((id,i)=>ids.indexOf(id)!==i)}")
    if checks["app"] != 1 or checks["scrollWidth"] > checks["viewport"] or checks["pageScroll"][0] > checks["pageClient"][0] or (checks["railScroll"] and checks["railScroll"][0] > checks["railClient"][0]) or checks["unnamed"] or checks["duplicateIds"] or not checks["heading"]:
        raise RuntimeError(f"render check failed for {name}: {checks}")
    return checks

def main():
    OUT.mkdir(exist_ok=True)
    server = subprocess.Popen(["python3", "-m", "http.server", str(PORT), "--bind", "127.0.0.1", "--directory", str(ROOT)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    driver = subprocess.Popen(["/snap/bin/firefox.geckodriver", "--port", str(DRIVER_PORT)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    session = None
    try:
        wait_for(BASE)
        wait_for(DRIVER + "/status")
        created = request("POST", "/session", {"capabilities": {"alwaysMatch": {"browserName": "firefox", "moz:firefoxOptions": {"args": ["-headless"]}}}})
        session = created["value"]["sessionId"]
        set_viewport(session, 1440, 900)
        for name, route in SHOTS.items():
            navigate(session, route)
            checks = verify_view(session, name)
            png = base64.b64decode(request("GET", f"/session/{session}/screenshot")["value"])
            (OUT / name).write_bytes(png)
            print(f"captured {name} · {checks['heading']} · rail={checks['rail'] or 'closed'} · page={checks['pageClient']}→{checks['pageScroll']} · rail={checks['railClient']}→{checks['railScroll']}")

        set_viewport(session, 1180, 900)
        for name, route in list(SHOTS.items())[:5]:
            navigate(session, route)
            checks = verify_view(session, f"1180:{name}")
            if checks["rail"]:
                rail = execute(session, "const r=document.querySelector('[data-overlay-rail]');const s=getComputedStyle(r);return {position:s.position,width:Math.round(r.getBoundingClientRect().width),right:Math.round(innerWidth-r.getBoundingClientRect().right)}")
                if rail != {"position": "fixed", "width": 400, "right": 0}:
                    raise RuntimeError(f"overlay check failed for {name}: {rail}")
        print("verified all five routes at 1180px without horizontal overflow")

        navigate(session, SHOTS["incident-inbox.png"])
        result = execute(session, "document.querySelector('[data-metric=critical]').click();return true")
        time.sleep(.1)
        filtered = execute(session, "return {rows:document.querySelectorAll('.object-table tbody tr').length,hash:location.hash}")
        if filtered["rows"] != 1 or "metric=critical" not in filtered["hash"]:
            raise RuntimeError(f"metric interaction failed: {filtered}")
        execute(session, "document.querySelector('[data-evidence=signal]').click();return true")
        time.sleep(.1)
        if execute(session, "return document.querySelector('[data-overlay-rail]')?.getAttribute('aria-label')") != "Evidence Viewer":
            raise RuntimeError("evidence rail replacement failed")
        execute(session, "document.querySelector('[data-action=return-rail]').click();return true")
        time.sleep(.1)
        if execute(session, "return document.querySelector('[data-overlay-rail]')?.getAttribute('aria-label')") != "Object Preview":
            raise RuntimeError("evidence rail return failed")
        print("verified metric filtering and mutually exclusive evidence rail")

        assist_states = {
            "ready": "return !!document.querySelector('.suggestions') && !document.querySelector('#assist-question').disabled",
            "running": "return !!document.querySelector('[aria-busy=true]') && document.querySelector('#assist-question').disabled",
            "answered": "return document.querySelectorAll('.citation-link').length===3",
            "failed": "return !!document.querySelector('.assist-state.error') && document.querySelector('#assist-question').value.length>0",
            "offline": "return !!document.querySelector('.assist-state.offline') && document.querySelector('#assist-question').disabled",
        }
        for state, assertion in assist_states.items():
            navigate(session, f"#/incidents/INC-2048?incident=INC-2048&rail=assist&assistState={state}")
            if not execute(session, assertion):
                raise RuntimeError(f"assist state failed: {state}")
        navigate(session, "#/floor?asset=MTR-12&incident=INC-2045&rail=assist")
        if not execute(session, "return !!document.querySelector('.assist-state.warning') && !document.querySelector('[data-assist-form]')"):
            raise RuntimeError("unsupported assist state failed")
        print("verified ready, running, answered, failed, offline, and unsupported Assist states")

        navigate(session, "#/floor?asset=RPP1&incident=INC-2048&rail=preview")
        execute(session, "const e=document.querySelector('[data-select-asset=\"MTR-12\"]');e.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));return true")
        time.sleep(.1)
        execute(session, "document.querySelector('[data-action=open-assist]').click();return true")
        time.sleep(.1)
        context = execute(session, "return {hash:location.hash,unsupported:!!document.querySelector('.assist-state.warning')}")
        if "asset=MTR-12" not in context["hash"] or not context["unsupported"]:
            raise RuntimeError(f"floor context propagation failed: {context}")

        navigate(session, "#/incidents?incident=INC-2048")
        execute(session, "const b=document.querySelector('[data-focus-id=assist-trigger]');b.focus();b.click();return true")
        time.sleep(.1)
        execute(session, "const rail=document.querySelector('[data-overlay-rail]');const f=[...rail.querySelectorAll('button:not([disabled]),textarea:not([disabled]),a[href]')];f.at(-1).focus();f.at(-1).dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));return true")
        trapped = execute(session, "const rail=document.querySelector('[data-overlay-rail]');const f=[...rail.querySelectorAll('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),a[href],[tabindex]:not([tabindex=\"-1\"])')];return {ok:document.activeElement===f[0],active:document.activeElement?.outerHTML?.slice(0,180),first:f[0]?.outerHTML?.slice(0,180),last:f.at(-1)?.outerHTML?.slice(0,180),count:f.length}")
        if not trapped["ok"]:
            raise RuntimeError(f"overlay focus trap failed: {trapped}")
        execute(session, "document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));return true")
        time.sleep(.1)
        restored = execute(session, "return !document.querySelector('[data-overlay-rail]') && document.activeElement?.dataset.focusId==='assist-trigger'")
        if not restored:
            raise RuntimeError("Escape close or focus restoration failed")
        print("verified floor context, overlay focus trap, Escape close, and focus restoration")
    finally:
        if session:
            try: request("DELETE", f"/session/{session}")
            except Exception: pass
        for process in (driver, server):
            try:
                os.killpg(process.pid, signal.SIGTERM)
                process.wait(timeout=5)
            except (ProcessLookupError, subprocess.TimeoutExpired):
                pass

if __name__ == "__main__":
    main()

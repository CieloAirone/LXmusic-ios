#!/usr/bin/env python3
"""Persistent release watcher. Credentials are read from a private systemd environment file."""
import fcntl
import json
import logging
import os
import time
import urllib.request
from pathlib import Path

ROOT = Path(os.environ.get('LX_MONITOR_STATE', '/var/lib/lx-ios-monitor'))
REPO = 'CieloAirone/LXmusic-ios'

def api(path, data=None):
    request = urllib.request.Request('https://api.github.com/' + path,
        data=json.dumps(data).encode() if data is not None else None,
        headers={'Authorization': 'Bearer ' + os.environ['GITHUB_TOKEN'],
                 'Accept': 'application/vnd.github+json', 'User-Agent': 'LX-iOS-release-monitor'})
    with urllib.request.urlopen(request, timeout=45) as response:
        body = response.read()
        return json.loads(body) if body else None

def cycle():
    release = api('repos/lyswhut/lx-music-mobile/releases/latest')
    identity = str(release['id']) + ':' + release['tag_name']
    statefile = ROOT / 'state.json'
    state = json.loads(statefile.read_text()) if statefile.exists() else {}
    now = time.time()
    if state.get('release') == identity and state.get('dispatched'):
        state['checked_at'] = now
    else:
        runs = api(f'repos/{REPO}/actions/workflows/upstream-sync.yml/runs?per_page=10')['workflow_runs']
        if any(run['status'] != 'completed' for run in runs):
            logging.info('Sync already active; will check again')
            return
        repo = api(f'repos/{REPO}')
        api(f'repos/{REPO}/actions/workflows/upstream-sync.yml/dispatches', {'ref': repo['default_branch']})
        state = {'release': identity, 'tag': release['tag_name'], 'dispatched': True, 'dispatched_at': now, 'checked_at': now}
        logging.info('Dispatched upstream sync for %s', release['tag_name'])
    temp = statefile.with_suffix('.tmp')
    temp.write_text(json.dumps(state, indent=2) + '\n')
    temp.replace(statefile)
    logging.info('Check completed: %s', release['tag_name'])

if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
    ROOT.mkdir(parents=True, exist_ok=True)
    with (ROOT / 'monitor.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        while True:
            try:
                cycle()
            except Exception as error:
                logging.error('Check failed (%s); retrying next interval', type(error).__name__)
            time.sleep(int(os.environ.get('LX_MONITOR_INTERVAL', '300')))

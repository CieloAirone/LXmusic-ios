#!/usr/bin/env python3
"""Apply a released upstream delta to the port; never overwrite conflicts."""
import json
import os
import re
import subprocess
import urllib.request
from pathlib import Path


def git(*args, check=True):
    return subprocess.run(['git', *args], check=check, text=True, capture_output=True)


def output(name, value):
    with open(os.environ['GITHUB_OUTPUT'], 'a') as stream:
        stream.write(f'{name}={value}\n')


request = urllib.request.Request(
    'https://api.github.com/repos/lyswhut/lx-music-mobile/releases/latest',
    headers={'User-Agent': 'LX-iOS-upstream-sync', 'Accept': 'application/vnd.github+json'},
)
with urllib.request.urlopen(request, timeout=30) as response:
    release = json.load(response)
tag = release['tag_name']
# Keep remote input out of shell commands, ref expressions, and workflow output injection.
if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,99}', tag):
    raise RuntimeError('Unsupported upstream tag syntax')
base = Path('.github/upstream-base.txt').read_text().strip()
if not re.fullmatch(r'[0-9a-f]{40}', base):
    raise RuntimeError('Invalid upstream baseline')
remote = 'https://github.com/lyswhut/lx-music-mobile.git'
git('fetch', '--no-tags', remote, base)
git('fetch', '--no-tags', remote, f'refs/tags/{tag}')
target = git('rev-parse', 'FETCH_HEAD^{commit}').stdout.strip()
output('changed', 'false')
# The initial port may be newer than the latest release; do not downgrade it.
if git('merge-base', '--is-ancestor', target, base, check=False).returncode == 0:
    print('No newer upstream release.')
    raise SystemExit(0)
if git('merge-base', '--is-ancestor', base, target, check=False).returncode != 0:
    raise RuntimeError('Upstream history diverged; manual review required')
branch = f'upstream-sync/{tag}'
if git('ls-remote', '--heads', 'origin', f'refs/heads/{branch}').stdout.strip():
    print('An update branch already exists; inspect its PR/build before retrying.')
    raise SystemExit(0)
# Preserve all iOS integration and CI files. Overlapping shared-code changes use
# Git's three-way merge; failed merges never get committed or pushed.
patch = git('diff', '--binary', base, target, '--', '.',
            ':(exclude)ios/**', ':(exclude).github/**',
            ':(exclude)Gemfile', ':(exclude)Gemfile.lock',
            ':(exclude)scripts/**', ':(exclude)react-native.config.js').stdout
Path('build/logs').mkdir(parents=True, exist_ok=True)
Path('build/logs/upstream.patch').write_text(patch)
git('switch', '-c', branch)
if patch:
    applied = git('apply', '--3way', '--index', 'build/logs/upstream.patch', check=False)
    Path('build/logs/upstream-merge.log').write_text(applied.stdout + applied.stderr)
    if applied.returncode:
        raise RuntimeError('Upstream conflicts with the iOS port. Download upstream-sync-logs; main was not changed.')
Path('.github/upstream-base.txt').write_text(target + '\n')
git('add', '.github/upstream-base.txt')
git('config', 'user.name', 'github-actions[bot]')
git('config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com')
git('commit', '-m', f'chore: port upstream release {tag}')
git('push', 'origin', f'HEAD:refs/heads/{branch}')
output('branch', branch)
output('tag', tag)
output('changed', 'true')
print(f'Prepared {branch}; default branch unchanged.')

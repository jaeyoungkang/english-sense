#!/usr/bin/env python3
# 지식 체계의 품질을 잰다. 모델은 knowledge/domain/knowledge-quality.md이고, 이 스크립트는 그 규칙 1의 "기계가 다 재는 것"과
# 규칙 2(경보)를, 보고의 꼴은 진단 스킬(.claude/skills/knowledge-diagnosis/SKILL.md) 4단계를 옮긴다. 모델과 어긋나면 모델을 따른다.
# 노드는 받은 저장소들의 knowledge/ 아래 머리표(id, kind)가 있는 문서와 .claude/skills/*/SKILL.md다. 이음은 모델 머리표의
# grafts_from(재료), 스킬 머리표의 metadata.background(배경), 모델 본문이 다른 모델을 이름·id·경로로 가리키는 것(읽기)이다.
# 고른 모델의 picked_from("<저장소>:<id>@<커밋>", 스킬은 metadata.picked_from)은 저장소를 건너 라이브러리의 원본을 가리키는 고른
# 이음이다. 같은 저장소 안의 판과 따로 읽어, 순환·파급·깊이·낡음의 전파에 넣지 않고 밀린 변경과 고른 수로만 센다.
# 경로 바로 앞에 저장소 이름을 적은 참조("project-base `knowledge/production.md`", knowledge/library.md 규칙 10)는 그 저장소에서
# 찾는다. 함께 받은 저장소나 .git/base-sync/<저장소>에 받아 둔 사본을 쓰고, 둘 다 없으면 깨진 참조와 따로 센다.
# 라이브러리가 자기 씨앗 표(.claude/skills/base-sync/project.md)에서 고르기로 적은 노드는 그 저장소 안에서 고립으로 세지 않는다.
# 쓰는 쪽이 고르기 전까지 라우팅 표에 없고 씨앗 스킬의 배경도 아니기 때문이다(knowledge/library.md 규칙 1).
# 핵심 스킬은 AGENTS.md "상황별로 읽을 문서" 표가 가리키는 스킬이고, 줄 한도는 그 저장소의 knowledge/model.md(도메인 모델)와
# knowledge/agents-md.md(다른 파일)에서 읽는다. 머리표는 줄 수에 세지 않는다. 낡음은 커밋한 기록으로 잰다.
# knowledge/domain/의 모델은 골격(knowledge/model.md "도메인 모델 쓰는 법")을 검사하고 항목 단위 값(모델 관계 9~12)을 잰다.
# --map은 품질 보고 대신 지식 지도(모델 관계 14)를 낸다. 노드를 씨앗, 고른 것, 이 저장소의 것으로 가르고(씨앗 표는 라이브러리의
# .claude/skills/base-sync/project.md), 재료·배경·고른 이음과 계약(contracts/ 아래 파일)을 그린다.
# 뜻이 같은 중복, 모순, 그릇된 길, 근거에 맞는 강도, 비대의 판정, 쓰임은 재지 않는다. 그 결과는 이 보고에 더한다.
# Python 3 표준 라이브러리만 쓴다. 아무것도 막지 않고, 잴 수 있으면 0으로 끝난다.
# 쓰는 법: python3 scripts/knowledge-quality.py [<저장소> ...] [--out <파일>]   (저장소를 주지 않으면 지금 저장소)
#         python3 scripts/knowledge-quality.py --map [<저장소> ...]   지식 지도. 기여한 저장소와 베이스를 함께 주면 나란히 그린다
import argparse, itertools, re, statistics, subprocess, sys
from collections import defaultdict
from pathlib import Path

FRONT = re.compile(r'\A---\n(.*?)\n---[ \t]*(?:\n|\Z)', re.S)
TICK = re.compile(r'`([^`\n]+)`')
CITE = re.compile(r'`([^`\n]+\.md)`(?:의)?\s*"([^"\n]+)"')
QUAL = re.compile(r'(?:^|[\s(])([a-z][a-z0-9_-]*(?:\.[a-z0-9_-]+)*)(?:의\s*|\s+)\Z')  # 경로 바로 앞의 저장소 이름
REVIEWED = re.compile(r'다시 보|닿지 않')
PIN_LINE = r'(grafts_from|background):'
LINKED = ('graft', 'background')  # 순환·파급·깊이·낡음의 전파를 재는 이음
LONG = 3.0  # 긴 항목으로 볼 선: 같은 종류 항목의 중앙값의 배수(모델 쟁점, 잠정)


def front(text):
    # 머리표를 표준 라이브러리로 읽는다. 한 단계 중첩(metadata:)과 따옴표 값만 다룬다.
    m = FRONT.match(text)
    if not m:
        return {}, text
    meta, parent = {}, None
    for line in m.group(1).splitlines():
        if not line.strip() or line.lstrip().startswith('#'):
            continue
        key, sep, val = line.strip().partition(':')
        if not sep:
            continue
        val = val.strip()
        if len(val) >= 2 and val[0] == val[-1] and val[0] in '"\'':
            val = val[1:-1]
        if line[:1] in ' \t':
            if parent is not None:
                meta[parent][key] = val
        elif val == '':
            meta[key], parent = {}, key
        else:
            meta[key], parent = val, None
    return meta, text[m.end():]


def pins(value):
    out = []
    for part in (value or '').split(','):
        ident, _, sha = part.strip().partition('@')
        if ident:
            out.append((ident.strip(), sha.strip()))
    return out


def picks(value):
    # "<저장소>:<id>@<커밋>"을 쉼표로 이은 값. 저장소를 적지 않은 항목은 저장소를 ''로 읽는다.
    out = []
    for part in (value or '').split(','):
        head, _, sha = part.strip().partition('@')
        repo, sep, ident = head.rpartition(':')
        if head:
            out.append((repo.strip() if sep else '', (ident if sep else head).strip(), sha.strip()))
    return out


def anchors(text):
    # 본문이 "절"로 짚을 수 있는 자리: 제목과, 목록 첫머리의 굵은 말("**다시 보기.**").
    heads = [h.strip() for h in re.findall(r'^#{1,6}\s+(.+?)\s*#*$', text, re.M)]
    bold = re.findall(r'^\s*(?:[-*]|\d+\.)\s+\*\*(.+?)\*\*', text, re.M)
    return heads + [b.strip().rstrip('.:') for b in bold]


def count_lines(text):
    return text.count('\n') + (1 if text and not text.endswith('\n') else 0)


SECTIONS = ['개념', '관계', '규칙', '배운 것', '쟁점', '한계와 출처']
REQUIRED = {'개념', '관계', '규칙', '한계와 출처'}
CITE_REL = re.compile(r'\(관계 (\d[^()]*)\)')


def list_items(lines, numbered, where, bad):
    # 절 하나의 목록 항목을 읽는다. 항목은 (번호, 글)이고, 글은 둘째 줄부터와 들여 쓴 목록·표를 한 칸 띄어 이은 것이다.
    # 골격을 벗어난 곳은 bad에 더한다(knowledge/model.md "도메인 모델 쓰는 법").
    items, cur = [], None
    start = re.compile(r'^(\d+)\. (.*)$' if numbered else r'^- (.*)$')
    other = re.compile(r'^- ' if numbered else r'^\d+\. ')
    for line in lines:
        m = start.match(line)
        if m:
            text = m.group(m.lastindex)
            num = int(m.group(1)) if numbered else len(items) + 1
            if numbered and num != len(items) + 1:
                bad.append(f'{where} 번호가 끊긴다({len(items) + 1} 자리에 {num})')
            if text.startswith('**'):
                bad.append(f'{where} {num}에 굵은 요지가 있다')
            cur = [text]
            items.append((num, cur))
        elif not line.strip():
            continue
        elif line[0] in ' \t' and cur is not None:
            cur.append(line.strip())
        elif numbered and line.startswith('### '):
            cur = None
        elif other.match(line):
            bad.append(f'{where}에 {"글머리표" if numbered else "번호"} 항목이 있다: {line[:30]}')
            cur = None
        else:
            bad.append(f'{where}에 항목 밖 글이 있다: {line.strip()[:30]}')
            cur = None
    return [(n, ' '.join(t)) for n, t in items]


def skeleton(body):
    # 도메인 모델의 골격을 검사하고 항목을 읽는다. 골격의 정본은 knowledge/model.md "도메인 모델 쓰는 법"이다.
    bad = []
    if not re.search(r'^# 도메인 모델: .+$', body, re.M):
        bad.append('제목이 "# 도메인 모델: <이름>"이 아니다')
    parts = re.split(r'^## +(.+?)\s*$', body, flags=re.M)
    secs = {}
    for name, text in zip(parts[1::2], parts[2::2]):
        if name not in SECTIONS:
            bad.append(f'정하지 않은 절 "{name}"')
        elif name in secs:
            bad.append(f'"{name}" 절이 두 번 있다')
        else:
            secs[name] = text
    known = [n for n in parts[1::2] if n in SECTIONS]
    if known != sorted(known, key=SECTIONS.index):
        bad.append('절의 차례가 다르다: ' + ', '.join(known))
    bad += [f'"{n}" 절이 없다' for n in SECTIONS if n in REQUIRED and n not in secs]
    concepts = []
    lines = secs.get('개념', '').splitlines()
    rows = [l for l in lines if l.startswith('|')]
    if rows:
        if [c.strip() for c in rows[0].strip().strip('|').split('|')] != ['개념', '뜻']:
            bad.append('개념 표의 머리가 "| 개념 | 뜻 |"이 아니다')
        for row in rows[2:]:
            cells = [c.strip() for c in re.split(r'(?<!\\)\|', row.strip().strip('|'))]
            if len(cells) != 2:
                bad.append(f'개념 표의 행이 두 칸이 아니다: {row[:30]}')
            concepts.append((cells[0], ' | '.join(cells)))
    if any(re.match(r'^(- |\d+\. )', l) for l in lines):
        bad.append('개념 절에 목록이 있다')
    relations = list_items(secs.get('관계', '').splitlines(), True, '관계', bad)
    rules = []
    nums = {n for n, _ in relations}
    for n, text in list_items(secs.get('규칙', '').splitlines(), True, '규칙', bad):
        # 근거는 항목 안의 "(관계 1, 3)"이다. 문장 끝에 달고 (잠정), (검사: …), (리뷰)가 뒤따를 수 있다.
        cites = []
        for got in CITE_REL.findall(text):
            if re.fullmatch(r'\d+(, \d+)*', got):
                cites += [int(x) for x in got.split(', ') if int(x) not in cites]
            else:
                bad.append(f'규칙 {n}의 근거 꼴이 "(관계 1, 3)"이 아니다: (관계 {got})')
        bad += [f'규칙 {n}의 근거에 없는 관계가 있다: {x}' for x in cites if x not in nums]
        rules.append((n, text, cites))
    list_items(secs.get('쟁점', '').splitlines(), False, '쟁점', bad)
    rest = body.replace(secs.get('개념', ''), '')
    used = {x for _, _, c in rules for x in c}
    names = [re.sub(r'\s*\([^()]*\)$', '', c).replace('**', '').replace('`', '').strip() for c, _ in concepts]
    return dict(bad=bad, concepts=concepts, relations=relations, rules=rules,
                ungrounded=[n for n, _, c in rules if not c], unused_relations=[n for n, _ in relations if n not in used],
                unused_concepts=[x for x in names if x and x not in rest])


class Repo:
    def __init__(self, path):
        p = Path(path).resolve()
        top = subprocess.run(['git', '-C', str(p), 'rev-parse', '--show-toplevel'], capture_output=True, text=True)
        if top.returncode:
            raise SystemExit(f'git 저장소가 아니다: {path}')
        self.root = Path(top.stdout.strip())
        self.name = self.root.name
        self.head = self.git('rev-parse', '--short', 'HEAD') or '(커밋 없음)'
        self.files = set((self.git('ls-files') or '').splitlines())
        self._body = {}
        self._subst = {}

    def git(self, *args):
        r = subprocess.run(['git', '-C', str(self.root), *args], capture_output=True, text=True)
        return r.stdout.strip() if r.returncode == 0 else None

    def commit(self, sha):
        return self.git('rev-parse', '--verify', '-q', f'{sha}^{{commit}}') if sha else None

    def body_at(self, rev, rel):
        if (rev, rel) not in self._body:
            r = subprocess.run(['git', '-C', str(self.root), 'show', f'{rev}:{rel}'], capture_output=True, text=True)
            self._body[rev, rel] = front(r.stdout)[1] if r.returncode == 0 else None
        return self._body[rev, rel]

    def substantive(self, rel, *rev):
        # rev 범위에서 rel을 바꾼 커밋 가운데 머리표만 고친 것을 뺀 커밋. 새 것부터 낸다. 범위를 읽지 못하면 None.
        key = (rel, rev)
        if key not in self._subst:
            log = self.git('log', '--format=%H', *rev, '--', rel)
            self._subst[key] = None if log is None else [
                c for c in log.split() if self.body_at(c, rel) != self.body_at(f'{c}^', rel)]
        return self._subst[key]

    def changed_since(self, sha, rel):
        full = self.commit(sha)
        if not full:
            return None
        got = self.substantive(rel, f'{full}..HEAD')
        return None if got is None else len(got)

    def last_change(self, rel):
        got = self.substantive(rel)
        if not got:
            return None
        return int(self.git('show', '-s', '--format=%ct', got[0]) or 0)

    def exists(self, rel):
        rel = rel.rstrip('/')
        return rel in self.files or (self.root / rel).exists()


class Node:
    def __init__(self, repo, rel, kind, ident, meta, text, body):
        self.repo, self.rel, self.kind, self.id = repo, rel, kind, ident
        self.meta, self.text, self.body = meta, text, body
        self.key = None
        title = re.search(r'^# (.+)$', body, re.M)
        self.title = title.group(1).strip() if title else ''
        name = self.title.split(':', 1)[1].strip() if self.title.startswith('도메인 모델:') else ''
        self.name = re.sub(r'\s*\(.*?\)\s*$', '', name)
        self.headings = anchors(body)
        md = meta.get('metadata') if isinstance(meta.get('metadata'), dict) else {}
        self.picks = picks(meta.get('picked_from') if kind == 'model' else md.get('picked_from'))
        if kind == 'model':
            self.pins = pins(meta.get('grafts_from'))
        else:
            self.pins = pins(md.get('background'))
            self.has_background = 'background' in md
            self.old_form = any(k in md or k in meta for k in ('kind', 'grafts_from'))

    def label(self):
        return self.key.replace('skill:', '')


def discover(repo):
    nodes = []
    for p in sorted((repo.root / 'knowledge').rglob('*.md')):
        text = p.read_text(encoding='utf-8')
        meta, body = front(text)
        if isinstance(meta.get('id'), str) and isinstance(meta.get('kind'), str):
            nodes.append(Node(repo, str(p.relative_to(repo.root)), 'model', meta['id'], meta, text, body))
    for p in sorted((repo.root / '.claude/skills').glob('*/SKILL.md')):
        text = p.read_text(encoding='utf-8')
        meta, body = front(text)
        ident = meta.get('name') if isinstance(meta.get('name'), str) else p.parent.name
        nodes.append(Node(repo, str(p.relative_to(repo.root)), 'skill', ident, meta, text, body))
    return nodes


def limits(repo):
    def find(rel, pattern):
        p = repo.root / rel
        m = re.search(pattern, p.read_text(encoding='utf-8')) if p.exists() else None
        return int(m.group(1)) if m else None
    return (find('knowledge/model.md', r'도메인 모델[^\n.]*?(\d+)\s*(?:라인|줄)'),
            find('knowledge/agents-md.md', r'다른 파일 하나는\s*(\d+)\s*(?:라인|줄)'))


def path_token(tok):
    return (not re.search(r'[<>*{}\s]', tok) and not tok.startswith(('http', '../', '~', '/', '-'))
            and bool(re.fullmatch(r'[\w.\-/]+', tok)) and ('/' in tok or re.search(r'\.(md|py|sh|ya?ml|json|ts|js)$', tok)))


def qualifier(body, start):
    # 본문의 start 자리에서 시작하는 경로 바로 앞에 적힌 저장소 이름. 없으면 None.
    pre = body[max(0, start - 80):start]
    m = QUAL.search(pre)
    if not m or m.start(1) == 0 and start > 80:
        return None
    return m.group(1)


def may_break(tok):
    # 찾지 못하면 깨진 참조로 볼 경로: `/`가 든 경로와, `/`로 끝나는 폴더.
    return '/' in tok.rstrip('/') or tok.endswith('/')


def resolve(repo, tok, here, by_rel):
    # 본문의 경로 하나를 저장소 안의 파일로 옮긴다. 노드면 노드를, 파일만 있으면 경로를, 없으면 None을 낸다.
    tok = tok.strip()
    tok = tok[2:] if tok.startswith('./') else tok
    cands = [tok, str((Path(here).parent / tok)).replace('\\', '/')]
    for c in cands:
        if c in by_rel:
            return by_rel[c]
    if '/' not in tok:
        hits = [r for r in by_rel if r.endswith('/' + tok)]
        if len(hits) == 1:
            return by_rel[hits[0]]
    for c in cands:
        if repo.exists(c):
            return c
    if '/' not in tok and any(f.rsplit('/', 1)[-1] == tok for f in repo.files):
        return tok
    return None


def mentions(node, models):
    # 모델 본문이 같은 저장소의 다른 모델을 가리키는 곳. 경로, `id`, 제목에서 뽑은 이름으로 찾는다.
    # 한 낱말 이름("표현", "게임")은 다른 뜻으로도 흔히 쓰여 "<이름> 모델"로만 찾는다.
    found = []
    ticks = set(TICK.findall(node.body))
    for m in models:
        if m is node or m.repo is not node.repo:
            continue
        hit = m.rel in node.body or m.id in ticks or f'{m.id}.md' in ticks
        if not hit and m.name:
            hit = (' ' in m.name and m.name in node.body) or f'{m.name} 모델' in node.body
        if hit:
            found.append(m)
    return found


def build(repos):
    nodes = [n for r in repos for n in discover(r)]
    multi = len(repos) > 1
    for n in nodes:
        base = n.id if n.kind == 'model' else 'skill:' + n.id
        n.key = f'{n.repo.name}/{base}' if multi else base
    models = [n for n in nodes if n.kind == 'model']
    by_repo_rel = {r: {n.rel: n for n in nodes if n.repo is r} for r in repos}

    def material(ident, home):
        same = [m for m in models if m.id == ident and m.repo is home]
        other = [m for m in models if m.id == ident and m.repo is not home]
        return (same or other or [None])[0]

    edges, outside, cited, outside_picks = [], [], defaultdict(set), []
    for n in nodes:
        kind = 'graft' if n.kind == 'model' else 'background'
        for ident, sha in n.pins:
            mat = material(ident, n.repo)
            if not mat:
                outside.append((n, ident))
                continue
            edges.append(dict(src=mat, dst=n, kind=kind, sha=sha, stale=mat.repo.changed_since(sha, mat.rel)))
    for n in nodes:
        for repo_name, ident, sha in n.picks:
            src = next((m for m in nodes if m.kind == n.kind and m.id == ident and m.repo.name == repo_name and m.repo is not n.repo), None)
            if not src:
                outside_picks.append((n, f'{repo_name}:{ident}'))
                continue
            edges.append(dict(src=src, dst=n, kind='pick', sha=sha, stale=src.repo.changed_since(sha, src.rel)))
    for n in models:
        grafted = {e['src'] for e in edges if e['dst'] is n and e['kind'] == 'graft'}
        mine = None
        for m in mentions(n, models):
            if m in grafted:
                continue
            mine = mine if mine is not None else n.repo.last_change(n.rel)
            theirs = m.repo.last_change(m.rel)
            edges.append(dict(src=m, dst=n, kind='read', sha='', stale=1 if mine and theirs and theirs > mine else 0))
    # 경로와 절. 스킬이 짚은 모델, 깨진 경로, 없는 절, 다른 저장소 참조를 모은다.
    by_name, clones = {r.name: r for r in repos}, {}

    def where(n, start):
        # 경로를 찾을 저장소와, 다른 저장소면 그 이름. 이름을 적었는데 그 저장소를 받지 않았으면 저장소 자리가 None이다.
        name = qualifier(n.body, start)
        if not name or name == n.repo.name:
            return n.repo, None
        if name in by_name:
            return by_name[name], name
        clone = n.repo.root / '.git' / 'base-sync' / name
        if clone not in clones:
            clones[clone] = Repo(clone) if (clone / '.git').exists() else None
        return clones[clone], name

    broken, missing_sections, skill_cites, crossed, elsewhere = [], [], defaultdict(set), [], []
    for n in nodes:
        for mt in TICK.finditer(n.body):
            tok = mt.group(1)
            if not path_token(tok):
                continue
            repo, name = where(n, mt.start())
            if name and may_break(tok):
                crossed.append((n, name, tok))
            if repo is None:
                if may_break(tok):
                    elsewhere.append((n, name, tok))
                continue
            got = resolve(repo, tok, n.rel if repo is n.repo else '', by_repo_rel.get(repo, {}))
            if got is None and '/' in tok.rstrip('/') or got is None and tok.endswith('/') and not any(
                    ('/' + f).find('/' + tok) >= 0 for f in repo.files):
                broken.append((n, f'{name}:{tok}' if name else tok))
            elif isinstance(got, Node) and got is not n and repo is n.repo:
                cited[got].add(n)
                if n.kind == 'skill' and got.kind == 'model':
                    skill_cites[n].add(got)
        for mt in CITE.finditer(n.body):
            tok, section = mt.groups()
            repo, name = where(n, mt.start())
            if repo is None:
                continue
            got = resolve(repo, tok, n.rel if repo is n.repo else '', by_repo_rel.get(repo, {})) if path_token(tok) else None
            heads = got.headings if isinstance(got, Node) else None
            if heads is None and isinstance(got, str) and got.endswith('.md') and (repo.root / got).exists():
                heads = anchors((repo.root / got).read_text(encoding='utf-8'))
            if heads is not None and not any(h == section or h.startswith(section + ' ') or h.startswith(section + '(') for h in heads):
                missing_sections.append((n, f'{name}:{tok}' if name else tok, section))
    routed = routing(repos, by_repo_rel)
    return nodes, edges, outside, outside_picks, broken, missing_sections, skill_cites, routed, cited, crossed, elsewhere


def routing(repos, by_repo_rel):
    # AGENTS.md "상황별로 읽을 문서" 표의 마지막 칸이 가리키는 노드.
    routed = set()
    for r in repos:
        p = r.root / 'AGENTS.md'
        if not p.exists():
            continue
        part = p.read_text(encoding='utf-8').split('## 상황별로 읽을 문서', 1)
        if len(part) < 2:
            continue
        for line in part[1].split('\n## ', 1)[0].splitlines():
            if not line.startswith('|') or re.match(r'^\|\s*-', line):
                continue
            cell = line.strip().strip('|').split('|')[-1]
            for tok in TICK.findall(cell):
                got = resolve(r, tok, 'AGENTS.md', by_repo_rel[r]) if path_token(tok) else None
                if isinstance(got, Node):
                    routed.add(got)
    return routed


def sccs(nodes, out):
    # 타잔의 강한 연결 요소. 둘 이상이거나 자기를 가리키는 요소가 순환이다.
    index, low, stack, on, res, counter = {}, {}, [], set(), [], [0]

    def visit(v):
        index[v] = low[v] = counter[0]
        counter[0] += 1
        stack.append(v)
        on.add(v)
        for w in out[v]:
            if w not in index:
                visit(w)
                low[v] = min(low[v], low[w])
            elif w in on:
                low[v] = min(low[v], index[w])
        if low[v] == index[v]:
            comp = []
            while True:
                w = stack.pop()
                on.discard(w)
                comp.append(w)
                if w is v:
                    break
            if len(comp) > 1 or v in out[v]:
                res.append(comp)

    for v in nodes:
        if v not in index:
            visit(v)
    return res


def measure(nodes, edges, routed, cited, limit_of, offered=frozenset()):
    # 파급, 깊이, 전파는 재료 이음과 배경 이음으로만 잰다. 고른 이음은 저장소 사이의 판이라 넣지 않는다. 읽기 이음은 서로 가리키는 짝이 흔해 따라가면 거의 모든 노드에
    # 닿고, 모델이 그 셈법을 아직 정하지 않았다(모델 "쟁점").
    out, inn = defaultdict(set), defaultdict(set)
    for e in edges:
        if e['kind'] in LINKED:
            out[e['src']].add(e['dst'])
            inn[e['dst']].add(e['src'])

    def reach(n):
        seen, stack = set(), [n]
        while stack:
            for v in out[stack.pop()]:
                if v not in seen:
                    seen.add(v)
                    stack.append(v)
        return seen

    depth = {}

    def d(n, path=()):
        if n in path:
            return 0
        if n not in depth:
            depth[n] = 0 if not inn[n] else 1 + max(d(m, path + (n,)) for m in inn[n])
        return depth[n]

    graft_out = defaultdict(set)
    for e in edges:
        if e['kind'] == 'graft':
            graft_out[e['src']].add(e['dst'])
    cycles = sccs(nodes, graft_out)
    touched = set()
    for e in edges:
        if e['kind'] in LINKED and e['stale']:
            touched |= {e['dst']} | reach(e['dst'])
    info = {}
    for n in nodes:
        sec = n.body.split('\n## 개념', 1)[1].split('\n## ', 1)[0] if '\n## 개념' in '\n' + n.body else ''
        lines = sec.splitlines()
        rows = [l for i, l in enumerate(lines) if l.startswith('|') and not re.match(r'^\|\s*:?-', l)
                and not (i + 1 < len(lines) and re.match(r'^\|\s*:?-', lines[i + 1]))]
        concepts = len(rows) + len([l for l in lines if l.startswith('- ')])
        size = count_lines(n.body)
        limit = limit_of(n)
        alone = not out[n] and n not in routed and not cited[n]
        info[n] = dict(lines=size, limit=limit, over=bool(limit and size > limit), concepts=concepts,
                       provisional=n.body.count('(잠정)'), impact=len(reach(n)), depth=d(n),
                       orphan=alone and n not in offered, spared=alone and n in offered)
    return dict(info=info, cycles=cycles, touched=touched)


def unreviewed(n):
    # 이 노드의 판(grafts_from, background)을 마지막으로 바꾼 커밋이 머리표만 고쳤고, 올린 판마다 옛 판 뒤로 이 노드의
    # 본문을 고친 커밋이 없으면 검토 없이 올린 이음이다. 다시 보고 바꿀 것이 없었다고 커밋에 적었으면 뺀다.
    # 옛 판이 이 저장소의 커밋이 아니면(고를 때 라이브러리의 커밋을 이 저장소의 커밋으로 다시 적은 것) 올린 것이 아니라 세지 않는다.
    r = n.repo
    c = r.git('log', '-1', '--format=%H', '-G', PIN_LINE, '--', n.rel)
    if not c or r.body_at(c, n.rel) != r.body_at(f'{c}^', n.rel):
        return None
    if REVIEWED.search(r.git('show', '-s', '--format=%B', c) or ''):
        return None
    before = subprocess.run(['git', '-C', str(r.root), 'show', f'{c}^:{n.rel}'], capture_output=True, text=True).stdout
    meta = front(before)[0]
    md = meta.get('metadata') if isinstance(meta.get('metadata'), dict) else {}
    old = dict(pins(meta.get('grafts_from') if n.kind == 'model' else md.get('background')))
    bumped = []
    for ident, sha in n.pins:
        if ident in old and old[ident] != sha:
            full = r.commit(old[ident])
            if not full:
                continue  # 옛 판이 이 저장소에 없으면 라이브러리의 커밋을 이 저장소의 커밋으로 다시 적은 것이다
            if not r.substantive(n.rel, f'{full}..{c}^'):
                bumped.append(ident)
    return (c[:7], bumped) if bumped else None


def duplicates(nodes):
    # 한 저장소의 다른 노드 사이에서 글자가 거의 같은 문장(세 낱말 묶음이 70% 넘게 겹친다). 저장소끼리는 고른 사본이라
    # 같은 문장이 흔해 견주지 않는다. 뜻이 같은 중복은 LLM이 판정한다.
    sents = []
    for n in nodes:
        for s in re.split(r'(?<=다\.)\s+|\n', n.body):
            w = re.findall(r'[가-힣A-Za-z0-9]+', s)
            if len(w) >= 12:
                sents.append((n, set(zip(w, w[1:], w[2:])), s.strip()[:80]))
    index = defaultdict(set)
    for i, (_, grams, _) in enumerate(sents):
        for g in grams:
            index[g].add(i)
    shared = defaultdict(int)
    for ids in index.values():
        if len(ids) < 50:
            for a, b in itertools.combinations(sorted(ids), 2):
                shared[a, b] += 1
    hits = []
    for (a, b), k in sorted(shared.items()):
        x, y = sents[a], sents[b]
        if x[0] is not y[0] and x[0].repo is y[0].repo and k / min(len(x[1]), len(y[1])) >= 0.7:
            hits.append((x[0], y[0], x[2]))
    return hits


def nid(n):
    return 'n_' + re.sub(r'\W', '_', n.key)


def health_map(nodes, edges, m, core, repos):
    lines = ['```mermaid', 'flowchart LR']
    info = m['info']

    def line(n):
        i = info[n]
        label = n.label() + (f'<br/>파급 {i["impact"]}' if i['impact'] >= 5 else '')
        shape = ('(["', '"])') if n.kind == 'skill' else ('["', '"]')
        cls = 'orphan' if i['orphan'] else 'big' if i['over'] else 'core' if n in core else 'ok'
        return f'{nid(n)}{shape[0]}{label}{shape[1]}:::{cls}'

    if len(repos) > 1:
        for r in repos:
            sub = re.sub(r'\W', '_', r.name)
            lines.append(f'  subgraph {sub}["{r.name}"]')
            lines += [f'    {line(n)}' for n in nodes if n.repo is r]
            lines.append('  end')
    else:
        lines += [f'  {line(n)}' for n in nodes]
    red = []
    for k, e in enumerate(edges):
        arrow = {'read': '-.->', 'pick': '==>'}.get(e['kind'], '-->')
        lines.append(f'  {nid(e["src"])} {arrow} {nid(e["dst"])}')
        if e['stale']:
            red.append(str(k))
    if red:
        lines.append(f'  linkStyle {",".join(red)} stroke:#c0392b,stroke-width:2.5px')
    lines += ['  classDef ok fill:#eef1f4,stroke:#8796a4,color:#17202a',
              '  classDef core fill:#dcf1ef,stroke:#127a78,color:#06302f',
              '  classDef big fill:#fbe4e4,stroke:#b33a3a,stroke-width:3px,color:#3a0d0d',
              '  classDef orphan fill:#f4f4f4,stroke:#bbbbbb,stroke-dasharray:4 3,color:#888888', '```']
    return '\n'.join(lines)


SEED_HEAD = '에서 씨앗과 고르는 것'
ORIGINS = (('seed', '씨앗'), ('picked', '고른 것'), ('unsure', '받은 것(씨앗인지 모름)'), ('own', '이 저장소의 것'))


def seed_table(root, lib):
    # <root>/.claude/skills/base-sync/project.md의 "## <lib>에서 씨앗과 고르는 것" 절의 표(knowledge/library.md 규칙 1). 갈래 칸이
    # 씨앗이나 고르기인 행의 모델 칸과 스킬 칸에서 id를 읽어 {('model'|'skill', id): 갈래}를 낸다. 절이 없으면 None.
    p = Path(root) / '.claude/skills/base-sync/project.md'
    if not p.exists():
        return None
    part = re.split(rf'^## +{re.escape(lib)}{SEED_HEAD}\s*$', p.read_text(encoding='utf-8'), maxsplit=1, flags=re.M)
    if len(part) < 2:
        return None
    table = {}
    for line in part[1].split('\n## ', 1)[0].splitlines():
        cells = [c.strip() for c in line.strip().strip('|').split('|')] if line.startswith('|') else []
        if len(cells) < 3 or cells[0] not in ('씨앗', '고르기'):
            continue
        for kind, cell in (('model', cells[1]), ('skill', cells[2])):
            for ident in cell.split(','):
                if re.fullmatch(r'[a-z0-9][a-z0-9_-]*', ident.strip()):
                    table[kind, ident.strip()] = cells[0]
    return table


def contract_use(repo, skills):
    # 계약은 저장소의 contracts/ 아래 파일이다. 스킬 폴더의 Markdown(SKILL.md, project.md)이 그 경로나 `contracts/`를 짚으면 그 스킬이
    # 계약을 쓴다. 스킬은 계약의 경로를 대개 그 프로젝트에 맞춘 project.md에 둔다. {계약 경로: [스킬]}을 낸다.
    files = sorted(f for f in repo.files if f.startswith('contracts/'))
    use = {f: [] for f in files}
    for s in skills:
        toks = set()
        for p in sorted((repo.root / s.rel).parent.glob('*.md')):
            toks |= {t.strip() for t in TICK.findall(p.read_text(encoding='utf-8'))}
        for f in files:
            if f in toks or {'contracts', 'contracts/'} & toks:
                use[f].append(s)
    return use


def knowledge_map(paths):
    # 지식 지도: 노드를 출처(씨앗, 고른 것, 이 저장소의 것)로 가르고 재료·배경·고른 이음과 계약을 그린다(모델 "지식 지도").
    # 머리표에서 그때그때 그리고 파일로 두지 않는다. 품질 신호는 품질 보고가 맡는다.
    repos = [Repo(p) for p in paths]
    nodes, edges, outside, outside_picks = build(repos)[:4]
    by_name, clones, found = {r.name: r for r in repos}, {}, {}

    def library(name, home):
        if name in by_name:
            return by_name[name]
        clone = home.root / '.git' / 'base-sync' / name
        if clone not in clones:
            clones[clone] = Repo(clone) if (clone / '.git').exists() else None
        return clones[clone]

    def table(name, home):
        # 씨앗 표는 라이브러리의 것을 먼저 읽고, 라이브러리를 받지 않았으면 이 저장소의 project.md에 옮겨 둔 같은 절을 읽는다.
        lib = library(name, home)
        for root, where in ((lib.root, f'{name}의 project.md') if lib else (None, None), (home.root, f'{home.name}의 project.md')):
            if root is not None and (key := (root, name)) not in found:
                found[key] = seed_table(root, name)
            if root is not None and found[key] is not None:
                return found[key], where
        return None, None

    pick_edge = {e['dst']: e for e in edges if e['kind'] == 'pick'}
    origin, sources = {}, defaultdict(set)
    for n in nodes:
        if not n.picks:
            origin[n] = dict(kind='own')
            continue
        lib_name, ident, sha = n.picks[0]
        got, where = table(lib_name, n.repo)
        side = got.get((n.kind, ident)) if got is not None else None
        e = pick_edge.get(n)
        behind = e['stale'] if e else None
        if e is None and (lib := library(lib_name, n.repo)) is not None and lib not in by_name.values():
            src = next((m for m in discover(lib) if m.kind == n.kind and m.id == ident), None)
            behind = lib.changed_since(sha, src.rel) if src else None
        origin[n] = dict(kind='seed' if side == '씨앗' else 'picked' if side == '고르기' else 'unsure', lib=lib_name, sha=sha,
                         behind=behind, note='' if side else '씨앗 표가 없다' if got is None else '씨앗 표에 없다')
        sources[n.repo].add(where or f'{lib_name}의 씨앗 표를 찾지 못함')
    offers = {r: seed_table(r.root, r.name) or {} for r in repos}
    contracts = {r: contract_use(r, [n for n in nodes if n.repo is r and n.kind == 'skill']) for r in repos}
    drawn = [e for e in edges if e['kind'] in LINKED + ('pick',)]

    def label(n):
        o = origin[n]
        if o['kind'] == 'own':
            return n.id
        behind = '?' if o['behind'] is None else o['behind']
        return f'{n.id}<br/>{o["lib"]}@{o["sha"]} · 밀린 {behind}'

    def cid(r, f):
        return 'c_' + re.sub(r'\W', '_', f'{r.name}/{f}')

    lines = ['```mermaid', 'flowchart LR']
    for r in repos:
        sub = 'r_' + re.sub(r'\W', '_', r.name)
        lines.append(f'  subgraph {sub}["{r.name}"]')
        for kind, word in ORIGINS:
            group = [n for n in nodes if n.repo is r and origin[n]['kind'] == kind]
            if not group:
                continue
            lines += [f'    subgraph {sub}_{kind}["{word}"]', '      direction TB']
            for n in group:
                shape = ('(["', '"])') if n.kind == 'skill' else ('["', '"]')
                lines.append(f'      {nid(n)}{shape[0]}{label(n)}{shape[1]}:::{kind}')
            lines.append('    end')
        if contracts[r]:
            lines += [f'    subgraph {sub}_contract["계약"]'] + [f'      {cid(r, f)}[("{f}")]:::contract' for f in contracts[r]] + ['    end']
        lines.append('  end')
    red = []
    for k, e in enumerate(drawn):
        lines.append(f'  {nid(e["src"])} {"==>" if e["kind"] == "pick" else "-.->" if e["kind"] == "background" else "-->"} {nid(e["dst"])}')
        if e['kind'] == 'pick' and e['stale']:
            red.append(str(k))
    for r in repos:
        for f, users in contracts[r].items():
            lines += [f'  {cid(r, f)} --o {nid(s)}' for s in users]
    if red:
        lines.append(f'  linkStyle {",".join(red)} stroke:#c0392b,stroke-width:2.5px')
    lines += ['  classDef seed fill:#dcf1ef,stroke:#127a78,color:#06302f', '  classDef picked fill:#e3ecfb,stroke:#2f5fa8,color:#0d2140',
              '  classDef unsure fill:#f4f4f4,stroke:#888888,stroke-dasharray:4 3,color:#333333',
              '  classDef own fill:#fdf1dc,stroke:#b07a12,color:#3a2604', '  classDef contract fill:#efe5f7,stroke:#6b3fa0,color:#24103a', '```']

    j = lambda xs: ', '.join(xs) or '-'
    count = lambda r, kind: [n for n in nodes if n.repo is r and origin[n]['kind'] == kind]
    split = lambda xs: f'{len(xs)}(모델 {sum(n.kind == "model" for n in xs)}, 스킬 {sum(n.kind == "skill" for n in xs)})'
    out = ['# 지식 지도', '',
           '모델: `knowledge/domain/knowledge-quality.md` "지식 지도". 저장소: ' + ', '.join(f'{r.name}(판 {r.head})' for r in repos) + '.', '',
           '씨앗은 프로젝트를 시작할 때 라이브러리에서 받은 것, 고른 것은 그 뒤 필요해서 고른 것, 이 저장소의 것은 `picked_from`이 없는 것이다. '
           '씨앗과 고른 것은 머리표가 같아(`picked_from`) 라이브러리의 씨앗 표(base-sync `project.md`의 "<라이브러리>에서 씨앗과 고르는 것")로 '
           '가른다. 씨앗 표를 찾지 못했거나 표에 없는 것은 "받은 것(씨앗인지 모름)"이다.', '',
           '## 저장소마다', '', '| 저장소 | 씨앗 | 고른 것 | 씨앗인지 모름 | 이 저장소의 것 | 계약 | 씨앗 표 |', '| --- | --- | --- | --- | --- | --- | --- |']
    for r in repos:
        out.append(f'| {r.name} | {split(count(r, "seed"))} | {split(count(r, "picked"))} | {split(count(r, "unsure"))} | '
                   f'{split(count(r, "own"))} | {len(contracts[r])} | {j(sorted(sources[r]))} |')
    out += ['', '## 지도', '', '청록은 씨앗, 파랑은 고른 것, 회색 점선은 씨앗인지 모르는 받은 것, 주황은 이 저장소의 것, 보라 원통은 계약이다. '
            '네모는 모델, 둥근 네모는 스킬이다. 실선은 재료 이음(`grafts_from`), 점선은 배경 이음(`background`), 굵은 화살표는 고른 이음'
            '(`picked_from`, 함께 받은 라이브러리에 원본이 있을 때만), 끝이 동그란 선은 계약을 쓰는 스킬이다. 받은 것의 이름 아래에는 고른 곳과 판, '
            '그 판 뒤로 라이브러리에서 본문이 바뀐 커밋 수(밀린 변경, 라이브러리를 받지 않았으면 ?)가 있고, 밀린 변경이 있는 고른 이음은 빨갛다.', '',
            '\n'.join(lines), '',
            '## 노드', '', '내놓는 갈래는 이 저장소를 라이브러리로 고르는 쪽에 이 노드가 씨앗인지 고르기인지다(이 저장소의 씨앗 표).', '',
            '| 노드 | 종류 | 갈래 | 고른 곳 | 판 | 밀린 변경 | 재료·배경 | 내놓는 갈래 |', '| --- | --- | --- | --- | --- | --- | --- | --- |']
    words = dict(ORIGINS)
    for n in nodes:
        o = origin[n]
        deps = j(f'{e["src"].label()}({"재료" if e["kind"] == "graft" else "배경"})' for e in edges if e['dst'] is n and e['kind'] in LINKED)
        behind = '' if o['kind'] == 'own' else '원본이나 판을 찾지 못함' if o['behind'] is None and o['lib'] in by_name else '?' if o['behind'] is None else o['behind']
        side = words[o['kind']] + (f'({o["note"]})' if o.get('note') else '')
        out.append(f'| {n.label()} | {"스킬" if n.kind == "skill" else "모델"} | {side} | {o.get("lib", "-")} | {o.get("sha", "-")} | '
                   f'{behind if behind != "" else "-"} | {deps} | {offers[n.repo].get((n.kind, n.id), "-")} |')
    out += ['', '## 이 저장소의 것이 기대는 씨앗과 고른 것', '', '| 이 저장소의 것 | 이음 | 씨앗·고른 것 |', '| --- | --- | --- |']
    out += [f'| {e["dst"].label()} | {"재료" if e["kind"] == "graft" else "배경"} | {e["src"].label()}({words[origin[e["src"]]["kind"]]}) |'
            for e in edges if e['kind'] in LINKED and origin[e['dst']]['kind'] == 'own' and origin[e['src']]['kind'] != 'own']
    out += ['', '## 계약', '', '| 저장소 | 계약 | 쓰는 스킬 |', '| --- | --- | --- |']
    out += [f'| {r.name} | `{f}` | {j(s.id for s in users)} |' for r in repos for f, users in contracts[r].items()]
    out += ['', '## 저장소 밖 재료와 원본', '', '함께 받은 저장소에 없는 재료, 배경 모델, 고른 모델의 원본이다.', '',
            '| 기대는 노드 | 재료·배경·원본 |', '| --- | --- |']
    out += [f'| {n.label()} | {i} |' for n, i in outside + outside_picks]
    return '\n'.join(out) + '\n'


def evaluate(paths):
    repos = [Repo(p) for p in paths]
    nodes, edges, outside, outside_picks, broken, missing_sections, skill_cites, routed, cited, crossed, elsewhere = build(repos)
    lims = {r: limits(r) for r in repos}

    def limit_of(n):
        dom, other = lims[n.repo]
        return dom if n.kind == 'model' and n.rel.startswith('knowledge/domain/') else other

    offers = {r: seed_table(r.root, r.name) or {} for r in repos}
    offered = {n for n in nodes if offers[n.repo].get((n.kind, n.id)) == '고르기'}
    m = measure(nodes, edges, routed, cited, limit_of, offered)
    skills = [n for n in nodes if n.kind == 'skill']
    core = {n for n in routed if n.kind == 'skill'}
    checks = []  # (스킬, 무엇이 어긋났는가)
    for s in skills:
        if not s.has_background:
            checks.append((s, '배경 없는 스킬' + (' (옛 꼴 머리표 kind·grafts_from를 쓴다. 배경 이음으로 읽지 않았다)' if s.old_form else '')))
            continue
        bg = {i for i, _ in s.pins}
        for mdl in sorted(skill_cites[s], key=lambda x: x.id):
            if mdl.id not in bg:
                checks.append((s, f'본문이 짚은 {mdl.rel}이 background에 없다'))
        for i in sorted(bg - {x.id for x in skill_cites[s]}):
            checks.append((s, f'background의 {i}를 본문이 경로로 한 번도 짚지 않는다'))
    for n, tok, section in missing_sections:
        if n.kind == 'skill':
            checks.append((n, f'짚은 절 {tok} "{section}"이 없다'))
    bumps = [(n, got) for n in nodes if n.pins and (got := unreviewed(n))]
    dups = duplicates(nodes)
    items = {n: skeleton(n.body) for n in nodes if n.kind == 'model' and n.rel.startswith('knowledge/domain/')}
    # 항목 길이의 중앙값은 받은 저장소들의 도메인 모델을 모두 모아 종류(관계, 규칙)마다 낸다.
    medians = {}
    for kind in ('relations', 'rules'):
        sizes = [len(it[1]) for s in items.values() for it in s[kind]]
        medians[kind] = statistics.median(sizes) if sizes else 0
    return dict(repos=repos, nodes=nodes, edges=edges, outside=outside, outside_picks=outside_picks, broken=broken, missing_sections=missing_sections,
                crossed=crossed, elsewhere=elsewhere, checks=checks, core=core, m=m, bumps=bumps, dups=dups, lims=lims, items=items, medians=medians)


def item_lines(r, long):
    # 도메인 모델의 골격과 항목 단위 값(모델 관계 9~13). 긴 항목은 같은 종류 항목의 중앙값의 몇 배인지로 보인다.
    # 긴 항목의 선은 사람이 정한다(모델 규칙 1). 그 배수를 넘는 항목을 모두 보이고, 경보로 올리지는 않는다(모델 규칙 2).
    items, med = r['items'], r['medians']
    kinds = (('relations', '관계'), ('rules', '규칙'))
    out = ['', '## 도메인 모델의 항목', '',
           f'항목 길이는 항목 하나의 글자 수다. 중앙값은 받은 저장소들의 도메인 모델을 모아 낸 값으로 관계 {med["relations"]:g}자, '
           f'규칙 {med["rules"]:g}자다. 골격을 어긴 모델의 값은 믿지 않는다.', '',
           '| 모델 | 골격 어김 | 개념 | 관계 | 규칙 | 가장 긴 관계·규칙 | 근거 없는 규칙 | 쓰이지 않는 관계 | 쓰이지 않는 개념 |',
           '| --- | --- | --- | --- | --- | --- | --- | --- | --- |']
    j = lambda xs: ', '.join(str(x) for x in xs) or '-'
    for n, s in items.items():
        top = max((len(it[1]) for k, _ in kinds for it in s[k]), default=0)
        out.append(f'| {n.label()} | {len(s["bad"])} | {len(s["concepts"])} | {len(s["relations"])} | {len(s["rules"])} | {top}자 | '
                   f'{j(s["ungrounded"])} | {j(s["unused_relations"])} | {j(s["unused_concepts"]).replace("|", "/")} |')
    longest = sorted(((len(it[1]) / med[k], n, word, it) for n, s in items.items() for k, word in kinds for it in s[k] if med[k]),
                     key=lambda x: -x[0])
    picked = [x for x in longest if x[0] > long]
    out += ['', '## 긴 항목', '', f'같은 종류 항목의 중앙값의 {long:g}배를 넘는 항목이다. 관계나 규칙이 여럿 뭉쳤는지는 LLM이 판정한다.', '',
            '| 모델 | 항목 | 글자 | 중앙값의 배수 | 첫머리 |', '| --- | --- | --- | --- | --- |']
    out += [f'| {n.label()} | {word} {it[0]} | {len(it[1])} | {x:.1f} | {it[1][:40].replace("|", "/")} |' for x, n, word, it in picked]
    out += ['', '## 골격 어김', '', '`knowledge/model.md` "도메인 모델 쓰는 법"의 골격을 벗어난 곳이다.', '', '| 모델 | 곳 |', '| --- | --- |']
    out += [f'| {n.label()} | {b.replace("|", "/")} |' for n, s in items.items() for b in s['bad']]
    return out


def use_lines(nodes, picked):
    # 쓰임의 첫 값: 고른 수. 라이브러리의 노드마다 그것을 고른 노드와 저장소를 센다(knowledge/library.md 규칙 7, 9). 고른 수가 0인
    # 노드는 이름이 고른 이음에 나온 저장소(라이브러리)의 노드만 보인다. 쓰는 저장소를 함께 받지 않으면 0이 쓰이지 않는다는 뜻이 아니다.
    users = defaultdict(list)
    for e in picked:
        users[e['src']].append(e['dst'])
    libs = {e['src'].repo for e in picked}
    out = ['', '## 고른 수', '', '고른 모델의 `picked_from`을 받은 저장소들에 걸쳐 센 값이다. 받지 않은 저장소의 쓰임은 세지 못한다.', '',
           '| 라이브러리의 노드 | 고른 노드 | 쓰는 저장소 |', '| --- | --- | --- |']
    for n in nodes:
        if n.repo in libs:
            got = users.get(n, [])
            repos = sorted({u.repo.name for u in got})
            out.append(f'| {n.label()} | {len(got)} | {", ".join(repos) or "없음(폐기 후보)"} |')
    return out


def report(paths, long=LONG):
    r = evaluate(paths)
    nodes, edges, m, info = r['nodes'], r['edges'], r['m'], r['m']['info']
    items = r['items'].values()
    n_rel, n_rule = sum(len(s['relations']) for s in items), sum(len(s['rules']) for s in items)
    pinned = [e for e in edges if e['kind'] in LINKED]
    reads = [e for e in edges if e['kind'] == 'read']
    picked = [e for e in edges if e['kind'] == 'pick']
    behind = [e for e in picked if e['stale'] or e['stale'] is None]
    stale = [e for e in pinned if e['stale']]
    unknown = [e for e in pinned if e['stale'] is None]
    stale_reads = [e for e in reads if e['stale']]
    big = sorted((n for n in nodes if info[n]['over']), key=lambda n: -info[n]['lines'])
    hubs = sorted(nodes, key=lambda n: (-info[n]['impact'], n.key))[:3]
    core_hit = sorted((n for n in r['core'] if n in m['touched']), key=lambda n: n.key)
    deepest = max(nodes, key=lambda n: info[n]['depth']) if nodes else None
    orphans = [n for n in nodes if info[n]['orphan']]
    broken = [(n, t) for n, t in r['broken']] + [(n, f'{t}의 "{s}"(절을 찾지 못함)') for n, t, s in r['missing_sections'] if n.kind == 'model']
    alarms = []
    for comp in m['cycles']:
        alarms.append(f'재료 이음에 순환이 있다: {" → ".join(n.label() for n in comp)}')
    if core_hit:
        alarms.append(f'낡은 이음이 핵심 스킬에 닿는다(후보. 바뀐 곳이 닿는지는 따로 본다): {", ".join(n.label() for n in core_hit)}')
    big_hubs = [h for h in hubs if info[h]['over']]
    if big_hubs:
        alarms.append('파급 상위 셋 가운데 줄 한도를 넘은 노드가 있다(비대 후보. 담은 대상의 수는 LLM이 센다): ' + ', '.join(
            f'{h.label()}(파급 {info[h]["impact"]}, {info[h]["lines"]}줄, 한도 {info[h]["limit"]})' for h in big_hubs))
    if r['dups']:
        alarms.append(f'글자가 거의 같은 문장이 다른 노드 사이에 {len(r["dups"])}쌍 있다(같은 규칙이 두 곳에 있는지 확인)')
    ratio = f'{len(stale)}/{len(pinned)}({100 * len(stale) // max(1, len(pinned))}%)'
    scope = ', '.join(f'{x.name}(판 {x.head}, 줄 한도 도메인 모델 {r["lims"][x][0] or "?"}·다른 파일 {r["lims"][x][1] or "?"})' for x in r['repos'])
    j = lambda xs: ', '.join(xs) or '없음'
    out = ['# 지식 체계 품질 보고', '',
           f'모델: `knowledge/domain/knowledge-quality.md`. 저장소: {scope}. 노드 {len(nodes)}(모델 {len(nodes) - sum(n.kind == "skill" for n in nodes)}, '
           f'스킬 {sum(n.kind == "skill" for n in nodes)}), 이음 {len(edges)}(재료 {sum(e["kind"] == "graft" for e in edges)}, '
           f'배경 {sum(e["kind"] == "background" for e in edges)}, 읽기 {len(reads)}, 고름 {len(picked)}).', '',
           f'상태판 한 줄: 경보 {len(alarms)}, 낡은 이음 {ratio}.', '',
           '## 경보', ''] + ([f'- {a}' for a in alarms] or ['- 없음']) + ['',
           '## 층마다', '', '| 층 | 값 |', '| --- | --- |',
           f'| 내용 | 줄 한도를 넘은 노드 {len(big)}개({j(f"{n.label()} {info[n]["lines"]}/{info[n]["limit"]}줄" for n in big)}), 비대인지는 '
           f'담은 대상을 세어 본다. 잠정 표시 {sum(i["provisional"] for i in info.values())}곳. 배경 없는 스킬 '
           f'{sum(1 for _, c in r["checks"] if c.startswith("배경 없는"))}개. 도메인 모델 {len(items)}개의 골격 어김 '
           f'{sum(len(s["bad"]) for s in items)}곳(모델 {sum(1 for s in items if s["bad"])}개), 개념 '
           f'{sum(len(s["concepts"]) for s in items)}, 관계 {n_rel}, 규칙 {n_rule}, 근거 없는 규칙 '
           f'{sum(len(s["ungrounded"]) for s in items)}/{n_rule}, 쓰이지 않는 관계 {sum(len(s["unused_relations"]) for s in items)}/{n_rel}, '
           f'쓰이지 않는 개념 {sum(len(s["unused_concepts"]) for s in items)}, 항목 길이 중앙값 관계 {r["medians"]["relations"]:g}자·'
           f'규칙 {r["medians"]["rules"]:g}자 |',
           f'| 관계 | 순환 {len(m["cycles"])}. 낡은 재료·배경 이음 {ratio}, 판을 찾지 못한 이음 {len(unknown)}. '
           f'낡은 읽기 이음 후보(읽히는 모델이 나중에 바뀜) {len(stale_reads)}/{len(reads)}. 그 영향이 닿는 노드 {len(m["touched"])}/{len(nodes)}. '
           f'파급 상위 {j(f"{h.label()} {info[h]["impact"]}" for h in hubs)}. '
           + (f'가장 깊은 노드 {deepest.label()}({info[deepest]["depth"]}단계). ' if deepest else '') +
           f'고립 {j(n.label() for n in orphans)}, 고르는 것이라 고립으로 세지 않은 노드 '
           f'{j(n.label() for n in nodes if info[n]["spared"])}. 깨진 참조 {len(broken)}. 다른 저장소 참조 {len(r["crossed"])}, 그 가운데 찾을 저장소가 '
           f'없는 것 {len(r["elsewhere"])}. 스킬의 배경 어긋남 '
           f'{sum(1 for _, c in r["checks"] if not c.startswith("배경 없는"))}. 검토 없이 올린 이음 {len(r["bumps"])}. '
           f'저장소 밖 재료 {len(r["outside"])}. 글자가 거의 같은 문장 {len(r["dups"])}쌍. '
           f'고른 이음 {len(picked)}, 밀린 변경이 있는 것 {len(behind)}, 저장소 밖 원본 {len(r["outside_picks"])} |',
           '| 쓰임 | 기계로 재지 않는다. 일의 견줌과 리더 과제의 결과를 더한다(모델 규칙 1) |', '',
           '## 품질 지도', '', '빨간 선은 낡은 이음, 붉은 굵은 테두리는 줄 한도를 넘은 노드, 청록은 라우팅 표가 가리키는 핵심 스킬, '
           '회색 점선은 고립이다. 실선은 재료·배경 이음, 점선 화살표는 읽기 이음, 굵은 화살표는 고른 이음이다.', '', health_map(nodes, edges, m, r['core'], r['repos']), '',
           '## 노드', '', '| 노드 | 종류 | 줄(한도) | 개념 | 잠정 | 파급 | 깊이 |', '| --- | --- | --- | --- | --- | --- | --- |']
    for n in nodes:
        i = info[n]
        kind = '스킬' + (' (핵심)' if n in r['core'] else '') if n.kind == 'skill' else n.meta.get('kind', '')
        out.append(f'| {n.label()} | {kind} | {i["lines"]}({i["limit"] or "-"}) | {i["concepts"]} | {i["provisional"]} | {i["impact"]} | {i["depth"]} |')
    out += ['', '## 낡은 이음', '', '재료나 배경 모델이 적힌 판 뒤로 본문을 바꾼 커밋 수다. 바뀐 곳이 닿는지는 따로 본다.', '',
            '| 재료·배경 | 기대는 노드 | 이음 | 적힌 판 | 그 뒤 바뀐 커밋 수 |', '| --- | --- | --- | --- | --- |']
    out += [f'| {e["src"].label()} | {e["dst"].label()} | {"재료" if e["kind"] == "graft" else "배경"} | {e["sha"]} | '
            f'{"판을 찾지 못함" if e["stale"] is None else e["stale"]} |'
            for e in sorted(stale + unknown, key=lambda e: (-(e['stale'] or 0), e['src'].key, e['dst'].key))]
    out += ['', '## 고른 모델의 밀린 변경', '', '고른 모델의 판 뒤로 라이브러리에서 본문이 바뀐 커밋 수다. 동기화 때 검토할 변경이고, 낡은 이음과 따로 센다.', '',
            '| 라이브러리의 원본 | 고른 노드 | 적힌 판 | 그 뒤 바뀐 커밋 수 |', '| --- | --- | --- | --- |']
    out += [f'| {e["src"].label()} | {e["dst"].label()} | {e["sha"]} | {"판을 찾지 못함" if e["stale"] is None else e["stale"]} |'
            for e in sorted(behind, key=lambda e: (-(e['stale'] or 0), e['src'].key, e['dst'].key))]
    out += use_lines(r['nodes'], picked)
    out += ['', '## 낡은 읽기 이음(후보)', '', '| 읽히는 모델 | 읽는 모델 |', '| --- | --- |']
    out += [f'| {e["src"].label()} | {e["dst"].label()} |' for e in stale_reads]
    out += ['', '## 스킬과 배경 모델', '', '| 스킬 | 어긋난 곳 |', '| --- | --- |']
    out += [f'| {s.label()} | {c} |' for s, c in r['checks']]
    out += ['', '## 깨진 참조', '', '찾지 못한 경로와 절이다. 경로 앞에 저장소 이름을 적은 것은 그 저장소에서 찾았고 `<저장소>:<경로>`로 '
            '보인다. 이름 없이 다른 저장소의 파일을 가리켰으면 여기에 잡힌다(`knowledge/library.md` 규칙 10).', '',
            '| 노드 | 가리킨 곳 |', '| --- | --- |']
    out += [f'| {n.label()} | {t if t.endswith("(절을 찾지 못함)") else f"`{t}`"} |' for n, t in broken]
    out += ['', '## 찾을 저장소가 없는 다른 저장소 참조', '', '경로 앞에 적은 저장소를 함께 받지 않았고 `.git/base-sync/<저장소>`에도 없어 '
            '찾아보지 못한 참조다. 깨진 참조로 세지 않는다.', '', '| 노드 | 저장소 | 가리킨 곳 |', '| --- | --- | --- |']
    out += [f'| {n.label()} | {name} | `{t}` |' for n, name, t in r['elsewhere']]
    out += ['', '## 검토 없이 올린 이음', '', '판만 올렸고 옛 판 뒤로 본문을 고친 커밋이 없다. 앞선 커밋에서 다시 봤을 수 있다. 옛 판이 이 저장소에 없는 것은 고를 때 다시 적은 판이라 세지 않는다.', '',
            '| 노드 | 커밋 | 올린 판 |', '| --- | --- | --- |']
    out += [f'| {n.label()} | {c} | {", ".join(ids)} |' for n, (c, ids) in r['bumps']]
    out += item_lines(r, long)
    out += ['', '## 저장소 밖 재료', '', '함께 받은 저장소에 없는 재료, 배경 모델, 고른 모델의 원본이다. 낡음과 밀린 변경은 재지 않는다.', '',
            '| 기대는 노드 | 재료·배경·원본 |', '| --- | --- |']
    out += [f'| {n.label()} | {i} |' for n, i in r['outside'] + r['outside_picks']]
    out += ['', '## 기계로 재지 않는 것', '', '뜻이 같은 중복, 모순, 그릇된 길, 근거에 맞는 강도, 비대의 판정, 절차를 품은 모델, 규칙을 품은 스킬, '
            '쓰임은 모델 규칙 1의 둘째 겹대로 보고 여기에 더한다.', '',
            '## 글자가 거의 같은 문장', '', '| 노드 | 노드 | 문장 |', '| --- | --- | --- |']
    out += [f'| {a.label()} | {b.label()} | {s.replace("|", "/")} |' for a, b, s in r['dups']]
    return '\n'.join(out) + '\n'


def main(argv=None):
    ap = argparse.ArgumentParser(description='지식 체계의 품질을 잰다(knowledge/domain/knowledge-quality.md).')
    ap.add_argument('repos', nargs='*', default=['.'], help='잴 저장소. 없으면 지금 저장소')
    ap.add_argument('--out', help='보고를 쓸 파일')
    ap.add_argument('--map', action='store_true', help='품질 보고 대신 지식 지도(출처, 재료·배경·고른 이음, 계약)를 낸다')
    ap.add_argument('--long', type=float, default=LONG, help=f'긴 항목으로 볼 선(같은 종류 항목의 중앙값의 몇 배). 기본 {LONG:g}')
    args = ap.parse_args(argv)
    text = knowledge_map(args.repos) if args.map else report(args.repos, args.long)
    if args.out:
        Path(args.out).write_text(text, encoding='utf-8')
    else:
        sys.stdout.write(text)


if __name__ == '__main__':
    main()

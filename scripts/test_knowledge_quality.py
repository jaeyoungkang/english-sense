#!/usr/bin/env python3
# knowledge-quality.py의 시험. 가짜 저장소 둘(재료 이음 하나가 낡은 것, 순환이 있는 것)을 만들어 값과 경보를 본다.
# 쓰는 법: python3 scripts/test_knowledge_quality.py   (임시 저장소는 TMPDIR 아래에 만들고 지운다)
import importlib.util, os, subprocess, tempfile, unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('kq', Path(__file__).resolve().parent / 'knowledge-quality.py')
kq = importlib.util.module_from_spec(spec)
spec.loader.exec_module(kq)

AGENTS = """# 가짜

## 상황별로 읽을 문서

| 상황 | 읽을 문서 |
| --- | --- |
| B를 한다 | `.claude/skills/do-b/SKILL.md` |

## 상태판
"""
MODEL_MD = '# 모델\n\n도메인 모델이 100라인(line)을 넘으면 비대한지 본다.\n'


def git(root, *args):
    r = subprocess.run(['git', '-C', str(root), '-c', 'user.name=t', '-c', 'user.email=t@example.com',
                        '-c', 'commit.gpgsign=false', *args], capture_output=True, text=True, check=True)
    return r.stdout.strip()


def write(root, rel, text):
    p = Path(root) / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding='utf-8')


def commit(root, msg):
    git(root, 'add', '-A')
    git(root, 'commit', '-q', '-m', msg)
    return git(root, 'rev-parse', '--short', 'HEAD')


def model(ident, kind, title, body, grafts=None):
    head = f'---\nid: {ident}\nkind: {kind}\n' + (f'grafts_from: "{grafts}"\n' if grafts else '') + '---\n\n'
    return head + f'# {title}\n\n' + body


def skill(name, background, body):
    meta = f'metadata:\n  background: "{background}"\n' if background else ''
    return f'---\nname: {name}\ndescription: 시험용 스킬.\n{meta}---\n\n# {name}\n\n' + body


class StaleRepo(unittest.TestCase):
    """재료 a가 b의 판 뒤로 바뀌어 a→b 이음이 낡고, 그 낡음이 핵심 스킬 do-b에 닿는다."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name) / 'stale'
        self.root.mkdir()
        git(self.root, 'init', '-q')
        write(self.root, 'AGENTS.md', AGENTS)
        write(self.root, 'knowledge/model.md', MODEL_MD)
        write(self.root, 'knowledge/domain/a.md', model('a', 'primitive', '도메인 모델: 가 나', '## 개념\n\n- 하나\n- 둘\n\n## 규칙\n\n1. 처음 규칙. (잠정)\n'))
        self.c1 = commit(self.root, '처음')
        write(self.root, 'knowledge/domain/b.md', model('b', 'grafted', '도메인 모델: 비', '## 규칙\n\n가 나 모델을 따른다.\n', f'a@{self.c1}'))
        c2 = commit(self.root, 'b')
        write(self.root, '.claude/skills/do-b/SKILL.md', skill('do-b', f'b@{c2}',
              '`knowledge/domain/b.md` "규칙"을 따른다. `knowledge/domain/b.md` "없는 절"도 본다. `knowledge/없는.md`도 본다.\n'))
        commit(self.root, '스킬')
        write(self.root, 'knowledge/domain/a.md', model('a', 'primitive', '도메인 모델: 가 나', '## 개념\n\n- 하나\n- 둘\n\n## 규칙\n\n1. 고친 규칙. (잠정)\n'))
        self.c3 = commit(self.root, 'a의 본문을 고친다')
        text = (self.root / 'knowledge/domain/a.md').read_text().replace('kind: primitive\n', 'kind: primitive\nnote: x\n')
        write(self.root, 'knowledge/domain/a.md', text)
        commit(self.root, 'a의 머리표만 고친다')

    def tearDown(self):
        self.tmp.cleanup()

    def edge(self, r, src, dst):
        return next(e for e in r['edges'] if e['src'].id == src and e['dst'].id == dst)

    def test_values(self):
        r = kq.evaluate([self.root])
        self.assertEqual(sorted(n.key for n in r['nodes']), ['a', 'b', 'skill:do-b'])
        self.assertEqual(self.edge(r, 'a', 'b')['stale'], 1)  # 머리표만 고친 커밋은 세지 않는다
        self.assertEqual(self.edge(r, 'b', 'do-b')['stale'], 0)
        self.assertEqual(self.edge(r, 'a', 'b')['kind'], 'graft')
        info = {n.key: v for n, v in r['m']['info'].items()}
        self.assertEqual(info['a']['impact'], 2)
        self.assertEqual(info['skill:do-b']['depth'], 2)
        self.assertEqual(info['a']['concepts'], 2)
        self.assertEqual(info['a']['provisional'], 1)
        self.assertEqual({n.key for n in r['m']['touched']}, {'b', 'skill:do-b'})
        self.assertEqual([n.key for n in r['core']], ['skill:do-b'])
        self.assertEqual(r['m']['cycles'], [])
        self.assertIn('짚은 절 knowledge/domain/b.md "없는 절"이 없다', [c for _, c in r['checks']])
        self.assertIn('knowledge/없는.md', [t for _, t in r['broken']])

    def test_report(self):
        text = kq.report([self.root])
        self.assertIn('낡은 이음이 핵심 스킬에 닿는다', text)
        self.assertIn('상태판 한 줄: 경보 1, 낡은 이음 1/2(50%).', text)
        self.assertNotIn('순환', text.split('## 층마다')[0])

    def bump(self, old, new):
        text = (self.root / 'knowledge/domain/b.md').read_text().replace(f'a@{old}', f'a@{new}')
        write(self.root, 'knowledge/domain/b.md', text)
        commit(self.root, 'b의 판을 올린다')

    def test_bump_without_review(self):
        # 옛 판(c1) 뒤로 b의 본문을 쓴 커밋이 있으면 검토한 것으로 친다.
        self.bump(self.c1, self.c3)
        r = kq.evaluate([self.root])
        self.assertEqual(self.edge(r, 'a', 'b')['stale'], 0)
        self.assertEqual(r['bumps'], [])
        # a가 다시 바뀌었는데 b의 본문은 그대로 두고 판만 올렸다.
        write(self.root, 'knowledge/domain/a.md', (self.root / 'knowledge/domain/a.md').read_text().replace('고친 규칙', '또 고친 규칙'))
        c5 = commit(self.root, 'a를 또 고친다')
        self.bump(self.c3, c5)
        r = kq.evaluate([self.root])
        self.assertEqual([(n.id, ids) for n, (_, ids) in r['bumps']], [('b', ['a'])])
        git(self.root, 'commit', '-q', '--amend', '-m', 'b의 판을 올린다. a의 바뀐 곳을 다시 보고 바꿀 것이 없었다')
        self.assertEqual(kq.evaluate([self.root])['bumps'], [])

    def test_repin_from_outside(self):
        # 옛 판이 이 저장소에 없으면(라이브러리의 커밋) 고를 때 다시 적은 판이라 커밋 본문에 문구가 없어도 세지 않는다.
        self.bump(self.c1, 'abcdef1')
        self.bump('abcdef1', self.c3)
        r = kq.evaluate([self.root])
        self.assertEqual(self.edge(r, 'a', 'b')['sha'], self.c3)
        self.assertEqual(r['bumps'], [])
        # 같은 저장소의 옛 판에서 본문 없이 판만 올린 것은 그대로 센다.
        write(self.root, 'knowledge/domain/a.md', (self.root / 'knowledge/domain/a.md').read_text().replace('고친 규칙', '또 고친 규칙'))
        c6 = commit(self.root, 'a를 또 고친다')
        self.bump(self.c3, c6)
        self.assertEqual([(n.id, ids) for n, (_, ids) in kq.evaluate([self.root])['bumps']], [('b', ['a'])])


class CycleRepo(unittest.TestCase):
    """x와 y가 서로를 재료로 삼는다. 배경 없는 스킬, 고립 노드, 저장소 밖 재료도 함께 본다."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name) / 'cycle'
        self.root.mkdir()
        git(self.root, 'init', '-q')
        write(self.root, 'AGENTS.md', AGENTS)
        write(self.root, 'knowledge/model.md', MODEL_MD)
        write(self.root, 'knowledge/domain/x.md', model('x', 'primitive', '도메인 모델: 엑스', '본문\n'))
        write(self.root, 'knowledge/domain/y.md', model('y', 'primitive', '도메인 모델: 와이', '본문\n'))
        write(self.root, 'knowledge/domain/z.md', model('z', 'primitive', '도메인 모델: 제트', '본문\n' * 101))
        c1 = commit(self.root, '처음')
        write(self.root, 'knowledge/domain/x.md', model('x', 'grafted', '도메인 모델: 엑스', '본문\n', f'y@{c1}'))
        write(self.root, 'knowledge/domain/y.md', model('y', 'grafted', '도메인 모델: 와이', '본문\n', f'x@{c1}'))
        write(self.root, '.claude/skills/do-b/SKILL.md', skill('do-b', '', '할 일.\n'))
        write(self.root, '.claude/skills/do-c/SKILL.md', skill('do-c', 'ghost@abc1234', '할 일.\n'))
        commit(self.root, '순환')

    def tearDown(self):
        self.tmp.cleanup()

    def test_values(self):
        r = kq.evaluate([self.root])
        self.assertEqual([sorted(n.id for n in c) for c in r['m']['cycles']], [['x', 'y']])
        self.assertIn('배경 없는 스킬', [c for s, c in r['checks'] if s.id == 'do-b'])
        self.assertEqual([(n.id, i) for n, i in r['outside']], [('do-c', 'ghost')])
        info = {n.key: v for n, v in r['m']['info'].items()}
        self.assertTrue(info['z']['orphan'])
        self.assertTrue(info['z']['over'])
        self.assertFalse(info['x']['orphan'])
        self.assertTrue(info['skill:do-c']['orphan'])  # 라우팅 표가 가리키지 않는다

    def test_report(self):
        alarms = kq.report([self.root]).split('## 층마다')[0]
        self.assertIn('재료 이음에 순환이 있다', alarms)
        self.assertNotIn('핵심 스킬', alarms)

    def test_two_repos(self):
        with tempfile.TemporaryDirectory() as other:
            git(other, 'init', '-q')
            write(other, 'knowledge/domain/ghost.md', model('ghost', 'primitive', '도메인 모델: 유령', '본문\n'))
            commit(other, '유령')
            r = kq.evaluate([self.root, other])
            self.assertEqual(r['outside'], [])
            e = next(e for e in r['edges'] if e['dst'].id == 'do-c')
            self.assertIsNone(e['stale'])  # 그 저장소에 없는 판은 재지 못한다
            self.assertTrue(all('/' in n.key for n in r['nodes']))


class PickedRepos(unittest.TestCase):
    """라이브러리 lib의 모델 m과 스킬 s를 앱 app이 골랐다. m은 고른 뒤 바뀌었고, 고른 이음은 그래프 지표에 들지 않는다."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        base = Path(self.tmp.name)
        self.lib, self.app = base / 'lib', base / 'app'
        for root in (self.lib, self.app):
            root.mkdir()
            git(root, 'init', '-q')
        write(self.lib, 'knowledge/domain/m.md', model('m', 'primitive', '도메인 모델: 엠', '## 규칙\n\n1. 처음 규칙.\n'))
        write(self.lib, 'knowledge/domain/unused.md', model('unused', 'primitive', '도메인 모델: 안 쓰임', '본문\n'))
        write(self.lib, '.claude/skills/s/SKILL.md', skill('s', '', '할 일.\n'))
        self.c1 = commit(self.lib, '처음')
        head = f'picked_from: "lib:m@{self.c1}"\n'
        copy = model('m', 'primitive', '도메인 모델: 엠', '## 규칙\n\n1. 처음 규칙.\n').replace('kind: primitive\n', 'kind: primitive\n' + head)
        write(self.app, 'knowledge/domain/m.md', copy)
        write(self.app, '.claude/skills/s/SKILL.md', skill('s', '', '할 일.\n').replace(
            'description: 시험용 스킬.\n', f'description: 시험용 스킬.\nmetadata:\n  picked_from: "lib:s@{self.c1}"\n'))
        write(self.app, 'knowledge/domain/ghosted.md', model('ghosted', 'primitive', '도메인 모델: 유령', '본문\n').replace(
            'kind: primitive\n', 'kind: primitive\npicked_from: "ghost:x@abc1234"\n'))
        commit(self.app, '고른다')
        write(self.lib, 'knowledge/domain/m.md', model('m', 'primitive', '도메인 모델: 엠', '## 규칙\n\n1. 고친 규칙.\n'))
        commit(self.lib, 'm을 고친다')

    def tearDown(self):
        self.tmp.cleanup()

    def test_parse(self):
        self.assertEqual(kq.picks('lib:m@abc1234, base:s@def5678'), [('lib', 'm', 'abc1234'), ('base', 's', 'def5678')])
        self.assertEqual(kq.picks('m@abc1234'), [('', 'm', 'abc1234')])
        self.assertEqual(kq.picks(None), [])

    def test_edges(self):
        r = kq.evaluate([self.lib, self.app])
        picks = {(e['src'].id, e['dst'].repo.name): e for e in r['edges'] if e['kind'] == 'pick'}
        self.assertEqual(sorted(picks), [('m', 'app'), ('s', 'app')])
        self.assertEqual(picks['m', 'app']['stale'], 1)  # 고른 뒤 라이브러리에서 본문이 바뀌었다
        self.assertEqual(picks['s', 'app']['stale'], 0)
        self.assertEqual([(n.id, i) for n, i in r['outside_picks']], [('ghosted', 'ghost:x')])
        self.assertEqual(r['outside'], [])
        info = {n.key: v for n, v in r['m']['info'].items()}
        self.assertEqual(info['lib/m']['impact'], 0)  # 고른 이음은 파급에 넣지 않는다
        self.assertEqual(r['m']['touched'], set())
        self.assertEqual(r['m']['cycles'], [])

    def test_report(self):
        text = kq.report([self.lib, self.app])
        self.assertIn('고름 2)', text)
        self.assertIn('고른 이음 2, 밀린 변경이 있는 것 1, 저장소 밖 원본 1', text)
        self.assertIn('| lib/m | app/m | ' + self.c1, text)
        self.assertIn('| lib/m | 1 | app |', text)
        self.assertIn('| lib/unused | 0 | 없음(폐기 후보) |', text)
        self.assertIn('상태판 한 줄: 경보', text)
        self.assertNotIn('| app/m | 0 |', text)  # 고른 쪽의 노드는 라이브러리가 아니라 고른 수를 세지 않는다


class CrossRepoRefs(unittest.TestCase):
    """앱 app의 모델이 경로 앞에 저장소 이름을 적어 lib, cloned, far의 파일을 가리킨다(knowledge/library.md 규칙 10).
    lib은 함께 받고, cloned는 app/.git/base-sync/cloned에 받아 두고, far는 받지 않았다."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        base = Path(self.tmp.name)
        self.lib, self.app = base / 'lib', base / 'app'
        for root in (self.lib, self.app):
            root.mkdir()
            git(root, 'init', '-q')
        write(self.lib, 'knowledge/domain/m.md', model('m', 'primitive', '도메인 모델: 엠', '## 규칙\n\n1. 규칙.\n'))
        commit(self.lib, '처음')
        cloned = self.app / '.git/base-sync/cloned'
        cloned.mkdir(parents=True)
        git(cloned, 'init', '-q')
        write(cloned, 'knowledge/y.md', '# 와이\n')
        commit(cloned, '처음')
        body = ('lib `knowledge/domain/m.md` "규칙"을 따르고, lib의 `knowledge/domain/m.md` "없는 절"도 본다.\n'
                'lib의\n`knowledge/domain/none.md`도 본다. cloned `knowledge/y.md`와 far `knowledge/x.md`도 본다.\n'
                '이름 없이 적은 `knowledge/domain/gone.md`도 있다. 모델 `knowledge/domain/a.md`는 이 저장소에 있다.\n')
        write(self.app, 'knowledge/domain/a.md', model('a', 'primitive', '도메인 모델: 에이', body))
        commit(self.app, '처음')

    def tearDown(self):
        self.tmp.cleanup()

    def test_qualifier(self):
        text = 'project-base `a/b.md`, game-base의 `c/d.md`, (game-base\n   `e/f.md`, 모델 `g/h.md`, Codex `i/j.md`, e.g. `k/l.md`'
        got = [kq.qualifier(text, m.start()) for m in kq.TICK.finditer(text)]
        self.assertEqual(got, ['project-base', 'game-base', 'game-base', None, None, None])

    def test_alone(self):
        r = kq.evaluate([self.app])
        self.assertEqual(sorted(t for _, t in r['broken']), ['knowledge/domain/gone.md'])
        self.assertEqual(sorted((name, t) for _, name, t in r['elsewhere']),
                         [('far', 'knowledge/x.md'), ('lib', 'knowledge/domain/m.md'), ('lib', 'knowledge/domain/m.md'),
                          ('lib', 'knowledge/domain/none.md')])
        self.assertEqual(len(r['crossed']), 5)  # cloned는 .git/base-sync에서 찾았다
        self.assertEqual(r['missing_sections'], [])  # 받지 않은 저장소의 절은 재지 않는다

    def test_with_lib(self):
        r = kq.evaluate([self.lib, self.app])
        self.assertEqual(sorted(t for _, t in r['broken']), ['knowledge/domain/gone.md', 'lib:knowledge/domain/none.md'])
        self.assertEqual([(name, t) for _, name, t in r['elsewhere']], [('far', 'knowledge/x.md')])
        self.assertEqual([(t, s) for _, t, s in r['missing_sections']], [('lib:knowledge/domain/m.md', '없는 절')])
        text = kq.report([self.lib, self.app])
        self.assertIn('깨진 참조 3. 다른 저장소 참조 5, 그 가운데 찾을 저장소가 없는 것 1', text)
        self.assertIn('| app/a | far | `knowledge/x.md` |', text)


SEEDS = """# base-sync — 이 프로젝트에 맞춘 것

## lib에서 씨앗과 고르는 것

| 갈래 | 모델 | 스킬 | 까닭 |
| --- | --- | --- | --- |
| 씨앗 | sd | s | 늘 쓴다 |
| 고르기 | pk | — | 필요할 때 |
| 받지 않음 | `knowledge/patterns/` | — | 정본은 lib |
"""


class KnowledgeMap(unittest.TestCase):
    """앱 app이 라이브러리 lib에서 씨앗 sd·s와 고르기 pk를 받았다. pk는 고른 뒤 lib에서 바뀌었고, app의 모델 own은 pk를 재료로 삼는다.
    app의 스킬 do는 project.md에서 계약 contracts/game.yaml을 짚는다. lib의 씨앗 표에 없는 lost와, 받지 않은 저장소에서 고른 far도 있다."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        base = Path(self.tmp.name)
        self.lib, self.app = base / 'lib', base / 'app'
        for root in (self.lib, self.app):
            root.mkdir()
            git(root, 'init', '-q')
        write(self.lib, '.claude/skills/base-sync/project.md', SEEDS)
        for ident in ('sd', 'pk', 'lost'):
            write(self.lib, f'knowledge/domain/{ident}.md', model(ident, 'primitive', f'도메인 모델: {ident}', '본문\n'))
        write(self.lib, '.claude/skills/s/SKILL.md', skill('s', '', '할 일.\n'))
        c1 = commit(self.lib, '처음')
        pick = lambda ident, repo='lib': f'kind: primitive\npicked_from: "{repo}:{ident}@{c1}"\n'
        for ident in ('sd', 'pk', 'lost'):
            write(self.app, f'knowledge/domain/{ident}.md', model(ident, 'primitive', f'도메인 모델: {ident}', '본문\n').replace(
                'kind: primitive\n', pick(ident)))
        write(self.app, 'knowledge/domain/far.md', model('far', 'primitive', '도메인 모델: 멀리', '본문\n').replace(
            'kind: primitive\n', pick('far', 'far')))
        write(self.app, '.claude/skills/s/SKILL.md', skill('s', '', '할 일.\n').replace(
            'description: 시험용 스킬.\n', f'description: 시험용 스킬.\nmetadata:\n  picked_from: "lib:s@{c1}"\n'))
        write(self.app, 'contracts/game.yaml', 'goal: 시험\n')
        c2 = commit(self.app, '고른다')
        write(self.app, 'knowledge/domain/own.md', model('own', 'grafted', '도메인 모델: 자기', '본문\n', f'pk@{c2}'))
        write(self.app, '.claude/skills/do/SKILL.md', skill('do', f'own@{c2}', '할 일.\n'))
        write(self.app, '.claude/skills/do/project.md', '- 계약 파일은 `contracts/game.yaml` 하나다.\n')
        commit(self.app, '자기 것')
        write(self.lib, 'knowledge/domain/pk.md', model('pk', 'primitive', '도메인 모델: pk', '고친 본문\n'))
        commit(self.lib, 'pk를 고친다')

    def tearDown(self):
        self.tmp.cleanup()

    def row(self, text, key):
        return next(l for l in text.splitlines() if l.startswith(f'| {key} |'))

    def test_table(self):
        self.assertEqual(kq.seed_table(self.lib, 'lib'), {('model', 'sd'): '씨앗', ('skill', 's'): '씨앗', ('model', 'pk'): '고르기'})
        self.assertIsNone(kq.seed_table(self.lib, 'other'))
        self.assertIsNone(kq.seed_table(self.app, 'lib'))

    def test_with_lib(self):
        text = kq.knowledge_map([self.app, self.lib])
        self.assertIn('| app | 2(모델 1, 스킬 1) | 1(모델 1, 스킬 0) | 2(모델 2, 스킬 0) | 2(모델 1, 스킬 1) | 1 | far의 씨앗 표를 찾지 못함, lib의 project.md |', text)
        self.assertIn('| 모델 | 고른 것 | lib |', self.row(text, 'app/pk'))
        self.assertTrue(self.row(text, 'app/pk').endswith('| 1 | - | - |'))  # 고른 뒤 lib에서 한 번 바뀌었다
        self.assertIn('| 씨앗 | lib |', self.row(text, 'app/sd'))
        self.assertIn('받은 것(씨앗인지 모름)(씨앗 표에 없다)', self.row(text, 'app/lost'))
        self.assertIn('받은 것(씨앗인지 모름)(씨앗 표가 없다)', self.row(text, 'app/far'))
        self.assertTrue(self.row(text, 'lib/sd').endswith('| 씨앗 |'))  # 이 저장소가 내놓는 갈래
        self.assertIn('| app/own | 재료 | app/pk(고른 것) |', text)
        self.assertNotIn('| app/do | 배경 |', text)  # 이 저장소의 것끼리의 이음은 이 표에 없다
        self.assertIn('| app | `contracts/game.yaml` | do |', text)
        self.assertIn('c_app_contracts_game_yaml --o n_app_skill_do', text)
        self.assertIn('n_lib_pk ==> n_app_pk', text)
        self.assertIn('pk<br/>lib@', text)
        self.assertIn('subgraph r_app_own["이 저장소의 것"]', text)
        self.assertNotIn('-.-> n_app_own', text)  # 읽기 이음은 그리지 않는다

    def test_alone(self):
        # 라이브러리를 받지 않으면 씨앗과 고른 것을 가르지 못하고 밀린 변경도 모른다. 이 저장소의 project.md에 옮겨 둔 표가 있으면 그것을 읽는다.
        text = kq.knowledge_map([self.app])
        self.assertIn('| app | 0(모델 0, 스킬 0) | 0(모델 0, 스킬 0) | 5(모델 4, 스킬 1) |', text)
        self.assertIn('pk<br/>lib@', text)
        self.assertIn('밀린 ?', text)
        write(self.app, '.claude/skills/base-sync/project.md', SEEDS)
        text = kq.knowledge_map([self.app])
        self.assertIn('| app | 2(모델 1, 스킬 1) | 1(모델 1, 스킬 0) |', text)
        self.assertIn('app의 project.md', text)
        cloned = self.app / '.git/base-sync/lib'
        subprocess.run(['git', 'clone', '-q', str(self.lib), str(cloned)], check=True, capture_output=True)
        text = kq.knowledge_map([self.app])
        self.assertIn('lib의 project.md', text)
        self.assertTrue(self.row(text, 'pk').endswith('| 1 | - | - |'))  # .git/base-sync에 받아 둔 사본으로 밀린 변경을 센다

    def test_orphan(self):
        # 라이브러리가 자기 씨앗 표에서 고르기로 적은 노드는 그 저장소 안에서 고립으로 세지 않는다(library 규칙 1). 씨앗과 표에 없는
        # 노드, 고른 쪽 저장소의 사본은 그대로 센다.
        r = kq.evaluate([self.app, self.lib])
        info = {n.key: v for n, v in r['m']['info'].items()}
        self.assertFalse(info['lib/pk']['orphan'])
        self.assertTrue(info['lib/pk']['spared'])
        self.assertTrue(info['lib/sd']['orphan'])
        self.assertTrue(info['lib/lost']['orphan'])
        self.assertTrue(info['lib/skill:s']['orphan'])
        self.assertTrue(info['app/lost']['orphan'])  # app의 사본은 lib의 표로 봐주지 않는다
        self.assertFalse(info['app/pk']['orphan'])  # own이 재료로 삼는다
        self.assertFalse(info['app/pk']['spared'])
        text = kq.report([self.app, self.lib])
        self.assertIn('고르는 것이라 고립으로 세지 않은 노드 lib/pk.', text)
        self.assertNotIn('lib/pk,', text.split('고립 ', 1)[1].split(', 고르는 것이라', 1)[0])

    def test_cli(self):
        out = Path(self.tmp.name) / 'map.md'
        kq.main(['--map', str(self.app), str(self.lib), '--out', str(out)])
        self.assertTrue(out.read_text(encoding='utf-8').startswith('# 지식 지도'))


class SharedSkills(unittest.TestCase):
    """정본 이동과 호스트 별칭이 노드·라우팅·씨앗·옛 판의 뜻을 바꾸지 않는다."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name) / 'lib'
        self.root.mkdir()
        git(self.root, 'init', '-q')
        write(self.root, 'AGENTS.md', AGENTS)
        write(self.root, 'knowledge/domain/a.md', model('a', 'primitive', '도메인 모델: 에이', '## 규칙\n\n1. 규칙.\n'))
        self.c1 = commit(self.root, '모델')
        self.old = '.claude/skills/do-b/SKILL.md'
        self.shared = 'shared-skills/do-b/SKILL.md'
        write(self.root, self.old, skill('do-b', f'a@{self.c1}', '`knowledge/domain/a.md` "규칙"을 따른다.\n'))
        write(self.root, '.claude/skills/base-sync/project.md', SEEDS)
        self.c2 = commit(self.root, '옛 경로의 스킬')

    def tearDown(self):
        self.tmp.cleanup()

    def move(self):
        (self.root / '.claude/skills').rename(self.root / 'shared-skills')
        (self.root / '.agents').mkdir()
        for host in ('.claude/skills', '.agents/skills'):
            os.symlink('../shared-skills', self.root / host)
        return commit(self.root, '스킬 정본을 옮긴다')

    def test_aliases_and_seed_table(self):
        self.move()
        for path in (self.old, self.shared, '.agents/skills/do-b/SKILL.md'):
            with self.subTest(path=path):
                write(self.root, 'AGENTS.md', AGENTS.replace(self.old, path))
                write(self.root, 'knowledge/domain/ref.md', model('ref', 'primitive', '도메인 모델: 참조', f'`{path}` "do-b"를 읽는다.\n'))
                r = kq.evaluate([self.root])
                skills = [n for n in r['nodes'] if n.kind == 'skill']
                self.assertEqual([n.rel for n in skills], [self.shared])
                self.assertEqual(r['core'], set(skills))
                self.assertIs(kq.resolve(skills[0].repo, path, 'AGENTS.md', {n.rel: n for n in r['nodes']}), skills[0])
                self.assertEqual(r['broken'], [])
                self.assertEqual(r['missing_sections'], [])
                self.assertEqual(next(e for e in r['edges'] if e['dst'] is skills[0])['stale'], 0)
        self.assertEqual(kq.seed_table(self.root, 'lib'), {('model', 'sd'): '씨앗', ('skill', 's'): '씨앗', ('model', 'pk'): '고르기'})

    def test_standalone_shared_and_codex_paths(self):
        # 두 호스트 링크가 없어도 정본을 읽고, Codex 폴더만 있는 저장소도 읽는다.
        for base in ('shared-skills', '.agents/skills'):
            with self.subTest(base=base):
                root = Path(self.tmp.name) / base.replace('/', '-')
                root.mkdir()
                git(root, 'init', '-q')
                write(root, f'{base}/s/SKILL.md', skill('s', '', '할 일.\n'))
                write(root, f'{base}/base-sync/project.md', SEEDS)
                commit(root, '처음')
                self.assertEqual([n.rel for n in kq.discover(kq.Repo(root))], [f'{base}/s/SKILL.md'])
                self.assertEqual(kq.seed_table(root, 'lib')[('skill', 's')], '씨앗')

    def test_move_keeps_picked_edge_and_history(self):
        app = Path(self.tmp.name) / 'app'
        app.mkdir()
        git(app, 'init', '-q')
        copy = skill('do-b', '', '할 일.\n').replace('description: 시험용 스킬.\n',
                 f'description: 시험용 스킬.\nmetadata:\n  picked_from: "lib:do-b@{self.c2}"\n')
        write(app, '.claude/skills/do-b/SKILL.md', copy)
        commit(app, '고른다')
        self.move()
        r = kq.evaluate([self.root, app])
        picked = next(e for e in r['edges'] if e['kind'] == 'pick')
        self.assertEqual(picked['src'].rel, self.shared)
        self.assertEqual(picked['stale'], 0)
        repo = kq.Repo(self.root)
        self.assertEqual(repo.body_at(self.c2, self.shared), repo.body_at('HEAD', self.shared))
        self.assertEqual(repo.changed_since(self.c2, self.shared), 0)
        self.assertEqual(repo.changed_since(self.c1, self.shared), 1)  # 처음 만든 본문은 센다.
        write(self.root, self.shared, (self.root / self.shared).read_text() + '실제로 본문을 고친다.\n')
        commit(self.root, '이동 뒤 본문을 고친다')
        self.assertEqual(kq.Repo(self.root).changed_since(self.c2, self.shared), 1)
        self.assertEqual(next(e for e in kq.evaluate([self.root, app])['edges'] if e['kind'] == 'pick')['stale'], 1)

    def test_unreviewed_scalar_metadata(self):
        original = (self.root / self.old).read_text()
        write(self.root, self.old, original.replace(f'metadata:\n  background: "a@{self.c1}"', 'metadata: unavailable'))
        commit(self.root, 'metadata가 문자열인 스킬')
        r = kq.evaluate([self.root])
        self.assertIn('배경 없는 스킬', [c for n, c in r['checks'] if n.id == 'do-b'])
        self.assertEqual(r['bumps'], [])
        write(self.root, self.old, original)
        commit(self.root, 'metadata를 다시 사전으로 쓴다')
        self.assertEqual(kq.evaluate([self.root])['bumps'], [])

    def test_unreviewed_pin_survives_move(self):
        # 첫 판 조정은 스킬을 만든 본문이 있으므로 제외한다. 그 뒤 판만 올린 것은 이동 전후 모두 잡는다.
        write(self.root, self.old, (self.root / self.old).read_text().replace(f'a@{self.c1}', f'a@{self.c2}'))
        c3 = commit(self.root, '첫 판 조정')
        write(self.root, self.old, (self.root / self.old).read_text().replace(f'a@{self.c2}', f'a@{c3}'))
        c4 = commit(self.root, '검토 없이 판만 올린다')
        self.assertEqual([(n.id, ids) for n, (_, ids) in kq.evaluate([self.root])['bumps']], [('do-b', ['a'])])
        self.move()
        self.assertEqual([(n.id, sha, ids) for n, (sha, ids) in kq.evaluate([self.root])['bumps']], [('do-b', c4, ['a'])])
        write(self.root, self.shared, (self.root / self.shared).read_text().replace(f'a@{c3}', f'a@{c4}'))
        commit(self.root, '이동 뒤에도 판만 올린다')
        self.assertEqual([(n.id, ids) for n, (_, ids) in kq.evaluate([self.root])['bumps']], [('do-b', ['a'])])


GOOD = """# 도메인 모델: 좋은 꼴

머리말.

## 개념

| 개념 | 뜻 |
| --- | --- |
| 가늠(guess) | 쓰이는 개념 |
| 놀이 | 본문에 나오지 않는 개념 |

그 밖의 개념은 `knowledge/concepts.md`를 따른다.

## 관계

1. 가늠은 첫째 관계다.
   둘째 줄도 같은 항목이다.
2. 둘째 관계는 어느 규칙의 근거도 아니다.
3. 셋째 관계.

## 규칙

### 묶음 가

1. 첫째 규칙(관계 1). (잠정) (리뷰)
2. 근거가 없는 규칙.

   | 표 | 뜻 |
   | --- | --- |
   | 항목 안의 표 | 길이에 든다 |

### 묶음 나

3. 셋째 규칙. (관계 1, 3)

## 쟁점

- 쟁점 하나.

## 한계와 출처

자유 꼴.
"""

BAD = """# 좋지 않은 꼴

## 관계

1. **굵은 요지.** 첫째 관계.
3. 번호가 끊긴 관계.
- 글머리표 관계.

항목 밖 문단.

## 개념

- 목록으로 쓴 개념

## 규칙

1. 범위로 단 근거(관계 1~3).
2. 없는 관계를 단다. (관계 9)
3. 잠정을 섞은 근거(관계 1, 잠정).

## 덧붙인 절

## 쟁점

1. 번호로 쓴 쟁점.
"""


class Skeleton(unittest.TestCase):
    """골격을 따른 가짜 모델과 어긴 가짜 모델(knowledge/model.md "도메인 모델 쓰는 법")."""

    def test_good(self):
        s = kq.skeleton(GOOD)
        self.assertEqual(s['bad'], [])
        self.assertEqual([c for c, _ in s['concepts']], ['가늠(guess)', '놀이'])
        self.assertEqual([n for n, _ in s['relations']], [1, 2, 3])
        self.assertEqual([(n, c) for n, _, c in s['rules']], [(1, [1]), (2, []), (3, [1, 3])])  # 번호는 묶음을 건너 이어 간다
        self.assertEqual(s['relations'][0][1], '가늠은 첫째 관계다. 둘째 줄도 같은 항목이다.')
        self.assertIn('항목 안의 표', s['rules'][1][1])
        self.assertEqual(s['ungrounded'], [2])
        self.assertEqual(s['unused_relations'], [2])
        self.assertEqual(s['unused_concepts'], ['놀이'])

    def test_bad(self):
        bad = kq.skeleton(BAD)['bad']
        for want in ['제목이 "# 도메인 모델: <이름>"이 아니다', '정하지 않은 절 "덧붙인 절"', '"한계와 출처" 절이 없다',
                     '관계 1에 굵은 요지가 있다', '관계 번호가 끊긴다(2 자리에 3)', '개념 절에 목록이 있다',
                     '규칙 1의 근거 꼴이 "(관계 1, 3)"이 아니다: (관계 1~3)', '규칙 2의 근거에 없는 관계가 있다: 9',
                     '규칙 3의 근거 꼴이 "(관계 1, 3)"이 아니다: (관계 1, 잠정)']:
            self.assertIn(want, bad)
        self.assertTrue(any(b.startswith('절의 차례가 다르다') for b in bad))
        self.assertTrue(any(b.startswith('관계에 글머리표 항목이 있다') for b in bad))
        self.assertTrue(any(b.startswith('관계에 항목 밖 글이 있다: 항목 밖 문단') for b in bad))
        self.assertTrue(any(b.startswith('쟁점에 번호 항목이 있다') for b in bad))

    def test_report(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / 'skel'
            root.mkdir()
            git(root, 'init', '-q')
            write(root, 'knowledge/domain/good.md', model('good', 'primitive', '', GOOD).replace('# \n\n', '', 1))
            write(root, 'knowledge/domain/bad.md', model('bad', 'primitive', '', BAD).replace('# \n\n', '', 1))
            commit(root, '처음')
            text = kq.report([root])
            self.assertIn('도메인 모델 2개의 골격 어김', text)
            self.assertIn('| good | 0 | 2 | 3 | 3 |', text)
            self.assertIn('| bad | 관계 1에 굵은 요지가 있다 |', text)
            self.assertIn('중앙값의 3배를 넘는 항목이다', text)
            self.assertIn('배를 넘는 항목이다', kq.report([root], long=1.5))


if __name__ == '__main__':
    unittest.main()

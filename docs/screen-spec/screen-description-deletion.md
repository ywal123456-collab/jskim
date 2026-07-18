# 画面設計書の削除方針（Phase 7B-3B-0 / 7B-3B-1）

このドキュメントは、Screen Spec Viewer における **画面設計書（Description JSON）削除** と、それと衝突する **Collector の Description 自動生成** についての調査結果と詳細設計です。

**Phase 7B-3B-0:** 調査・設計（削除 API / Viewer UI は含まない）。
**Phase 7B-3B-1（実装済み）:** Collector は missing Description を自動生成しない。IMPLEMENTATION_ONLY を安定維持する。
**Phase 7B-3B-2 以降（未実装）:** `FileDescriptionStore.delete` / DELETE API → Viewer 削除 UI。

関連:

- 設計先行 CRUD 全体: [design-first-crud.md](./design-first-crud.md)
- 収集項目の除外: [collected-item-exclusion.md](./collected-item-exclusion.md)
- companion 概要: [README.md](./README.md)

7B-3B-0 調査時点のリポジトリ HEAD: `97df80a`。

---

## 1. 背景

画面一覧は次の union です。

```text
Description documents
∪
implementation / source screens
```

状態:

| 条件 | status |
|------|--------|
| Description あり・実装なし | `design-only`（DESIGN_ONLY） |
| Description なし・実装あり | `implementation-only`（IMPLEMENTATION_ONLY） |
| 両方あり | `linked`（LINKED） |

ユーザーが期待する「画面設計を削除」は次のとおりです。

```text
DESIGN_ONLY 削除
→ Description ファイル削除
→ 画面一覧から消える

LINKED 削除
→ Description のみ削除
→ source / snapshot は残る
→ IMPLEMENTATION_ONLY に遷移

IMPLEMENTATION_ONLY
→ 削除する Description が無い
```

しかし現行 Collector は **Description ファイルが無い Source 画面に対して必ず draft Description を新規作成**します。
そのため LINKED の Description を filesystem から消しても、次の collect で再び LINKED になります。

本設計の目的は、この衝突を解消し、削除の意味と Collector の責任境界を確定することです。

---

## 2. 用語

| 用語 | 意味 |
|------|------|
| **画面設計書削除** | `spec/{project}/src/data/{screenId}.json`（Description）だけを消す |
| **実装画面削除** | HTML / Nunjucks / Vue / `.spec.json` / snapshot 等の実装側削除。**本機能の対象外** |
| **Collector** | Playwright 等で snapshot を取り、Description に item placeholder を merge する処理 |
| **IMPLEMENTATION_ONLY draft** | Description ファイル無し時に GET が返すメモリ上の正規化 document（ディスクへ書かない） |
| **archive / ORPHAN** | 本機能では扱わない |

---

## 3. 現行画面状態

実装参照:

- `jskim-screen-spec/src/builder/load-screen-spec-project.ts`（union と status 判定）
- Viewer manifest は `create-viewer-manifest.ts` が上記を消費

削除機能を入れる前でも、状態モデル自体は既に DESIGN_ONLY / IMPLEMENTATION_ONLY / LINKED を表現できます。
問題は **IMPLEMENTATION_ONLY が collect 後に安定しない** 点です。

---

## 4. Collector 動作（7B-3B-0 調査時 → 7B-3B-1 後）

> **注:** §4.2〜4.4 は 7B-3B-0 時点の実測（自動生成あり）です。
> **7B-3B-1 以降**は候補 A を実装済みで、missing Description ではファイルを作りません（§9）。

### 4.1 入口

| 層 | 場所 |
|----|------|
| CLI | `bin/jskim.js` → `runSpecCollectCommand` |
| Orchestration | `scripts/lib/run-screen-spec-collect.js` |
| Watch/dev | `scripts/lib/create-spec-dev-orchestrator.js` |
| Core | `jskim-screen-spec/src/collector/collect-screen-spec-project.ts` → `collectScreenSpecProject` |

収集対象は Source（`src/{project}/pages/**/*.spec.json`）のみです。DESIGN_ONLY は collect しません。

### 4.2 Description 読み書き

1. 各 Source 画面で DOM から `foundItemIds` を抽出
2. `spec/{project}/src/data/{screenId}.json` を対象に `pendingDescriptions` へ積む
3. 最後に必ず `writeCollectedDescription` を呼ぶ（存在チェックでスキップしない）

参照: `collect-screen-spec-project.ts`（概ね 263–317 行付近）。

### 4.3 ファイルが無いときの処理（コード）

`writeCollectedDescription`（`write-collected-description.ts`）:

1. `readDescriptionForCollect` — ファイル無しなら `parsed: null`、`revision = emptyRevision`
2. `mergeDescription({ existing: null, ... })` — **新規 1.2 draft を組み立て**（`created: true`）
3. `writeFileAtomic` — 宛先無しなら TEMP → rename で **新規作成**（`createFileAtomic` は使わない）

`mergeDescription`（`merge-description.ts`）の `existing: null` 分岐:

```text
schemaVersion: "1.2"
screen: { id, name: "", description: "" }
itemOrder: DOM 順
items: 各 ID に空欄 placeholder
excludedItems: {}
```

### 4.4 実測（一時ワークスペース、2026-07-18）

`crud-create` を TEMP にコピーして検証しました。

| Case | 手順 | 結果 |
|------|------|------|
| **C** | Description 削除後に `FileDescriptionStore.read` | `exists: false`、draft items 8 件。**ファイルは再作成されない** |
| **A** | Description 削除後に `writeCollectedDescription`（collect と同じ書込経路） | **ファイル再作成**。`schemaVersion: "1.2"`、`excludedItems: {}`、placeholder items |
| **B** | 上記のあと `loadScreenSpecProject` | status は再び **`linked`** |

結論: **collect（の Description 書込）は missing Description を必ず作成する。GET だけでは作成しない。**

---

## 5. Description 自動生成の問題

現行の公開文書（例: `docs/screen-spec/README.md`「未作成時は draft を作成」、companion README「Description が無い場合は draft を作成する」、`design-first-crud.md` §5.6）は collect による draft 作成を前提にしています。

一方で削除の期待値（LINKED → IMPLEMENTATION_ONLY の安定維持）とは矛盾します。

```text
ユーザー: LINKED の設計書を削除した
→ Description 無し = IMPLEMENTATION_ONLY を期待
→ 次の collect（または source 変更による watcher collect）
→ Collector が draft を新規作成
→ 再び LINKED
→ 「削除が効いていない」ように見える
```

手動で書いた説明は失われ、空 draft で戻るため、意図した削除でもありません。

---

## 6. 削除対象

### 削除する

```text
spec/{project}/src/data/{screenId}.json
```

### 削除しない（絶対に）

```text
source page / HTML / Nunjucks / Vue
*.spec.json
snapshot
resources / images / CSS / JS
collector の観測結果そのもの（DOM 上の実装）
```

画面設計書 Viewer の削除は **実装画面削除ではない**。

---

## 7. 状態別削除契約（推奨）

### 7.1 DESIGN_ONLY

```text
Description 削除
→ union から画面が消える
```

削除後 route:

```text
次の安定画面へ fallback
→ 無ければ前の画面
→ 0 画面なら empty state
```

### 7.2 LINKED

```text
Description 削除
source / snapshot / resources は維持
→ IMPLEMENTATION_ONLY
```

同じ `screenId` route を維持できる。表示名は実装側名・無ければ `screenId`。

**前提:** Collector が missing Description を再作成しないこと（§9）。

### 7.3 IMPLEMENTATION_ONLY

Description が無いため Viewer に削除 action を出さない。
DELETE API が来た場合は:

```text
404 SPEC_DESCRIPTION_NOT_FOUND
（または同等の明確な「削除対象の Description が無い」エラー）
```

を返す。

---

## 8. Collector 方針候補

### 候補 A: Description が無い画面では Collector が生成しない（推奨）

```text
Description なし
→ snapshot / resources / observation のみ更新
→ Description ファイルは作らない

Description あり
→ 既存の merge（新規 item 末尾追加、excluded 抑制、manual 保全、revision retry）を維持
```

Description の初回永続化は **Viewer PUT（または POST create / 複製）だけ**。

### 候補 B: suppression / tombstone

project 設定や別 JSON に「再生成禁止 screenId」を持つ。

- 長所: 現行「collect で draft 作成」を維持しつつ削除だけ抑制できる
- 短所: 新規 persisted モデル、削除との二重管理、screenId 再利用・復元、Schema/API が増える

### 候補 C: ファイルを消さず reset

items を placeholder に戻し Description を残す。

- 長所: Collector 再生成問題が起きない
- 短所: IMPLEMENTATION_ONLY にならない。ユーザーの「削除」と意味が違う

### 候補 D: 削除後も Collector 再生成を許容

削除意図が維持されず、UX として失敗に見える。**非推奨**。

---

## 9. 推奨 Collector 方針

**候補 A を採用する。**

根拠:

1. 「Collector は実装を観察し、Description は人が管理する」という境界が明確
2. LINKED 削除後の IMPLEMENTATION_ONLY が安定する
3. 既に GET はファイル無し draft を合成でき、Preview / 項目一覧は動作する（§10）
4. suppression のような追加永続モデルが不要
5. 変更点は「missing のとき write しない」に局所化できる（既存 merge 全体の書き換え不要）

変更イメージ（実装は 7B-3B-1）:

```text
writeCollectedDescription 呼び出し前:
  if (!fs.existsSync(descriptionPath)) skip write
または writeCollectedDescription 内:
  parsed === null → written: false で return（ファイルを作らない）
```

既存 Description があるときの merge / excludedItems / revision retry は現状維持。

---

## 10. 実装先行フローへの影響

候補 A 適用後の推奨フロー:

```text
実装画面を collect
→ snapshot / resources 更新
→ Description ファイルは無い → IMPLEMENTATION_ONLY
→ Viewer GET が snapshot から placeholder draft を合成（書かない）
→ ユーザーが説明を編集し初回 PUT
→ Description 作成 → LINKED
→ 以降の collect は既存 Description に merge
```

現行で既に揃っている点:

| 項目 | 現状 |
|------|------|
| GET draft 合成 | `buildMissingFileState` / `buildImplementationDraftDocument`。ディスク非書込（実測 Case C） |
| Preview | snapshot があれば `hasPreview: true` |
| 項目一覧 | draft `itemOrder` / `items` で表示可能 |
| 初回永続化 | PUT または POST（`createFileAtomic` / `writeFileAtomic`） |

したがって **Description 自動生成を止めても実装先行 workflow は成立する**。
欠けていたのは「意図しない再 LINKED」を防ぐ側である。

---

## 11. 既存互換性

### 公開ドキュメント・挙動

- companion / Screen Spec README は「collect で未作成 Description を draft 作成」と明記
- `design-first-crud.md` §5.6 は LINKED 削除後「次の collect で IMPLEMENTATION_ONLY」と書いており、**現行コードと矛盾**（現状は再 LINKED）
- sample は Description JSON をリポジトリに同梱しており、collect 初回生成に依存しない

### 互換性評価

候補 A は **collect の公開副作用を変える breaking change** になり得る。

ただし:

- Description が既にある LINKED 画面の merge 挙動は変えない
- 実装先行で「まず Viewer で保存」は既に UI（IMPLEMENTATION_ONLY GET + PUT）で可能
- 削除機能を正しく動かすには方針変更が必須

### 推奨 migration

```text
7B-3B-1 で候補 A を即座に採用する
（0.1.0 companion / 0.6.0 系の patch または次の機能リリースに同梱）
```

理由:

- suppression flag や二段階 deprecate は削除機能の価値に対して重い
- ドキュメントと sample を同時更新すれば移行コストは小さい
- 「collect だけして Description を手動編集せず放置」していた場合のみ影響。その Description は空 draft が多く、初回 PUT で同等物を作れる

config flag による永続 dual mode は採用しない（複雑さに見合わない）。

---

## 12. FileDescriptionStore 削除契約

推奨 API（実装は 7B-3B-2）:

```ts
delete(screenId: string, expectedRevision: string): {
  screenId: string;
  deleted: true;
}
```

保証:

```text
Description ファイルのみ削除
expectedRevision 不一致 → 409 SPEC_DESCRIPTION_REVISION_CONFLICT
ファイル無し / 未登録 → 404
source / snapshot は触らない
成功後に TEMP / backup を残さない
```

登録判定は既存どおり `listScreenIds()`（union）。
IMPLEMENTATION_ONLY（ファイル無し）への DELETE は 404。

---

## 13. revision と競合

### DELETE vs PUT

```text
同じ expectedRevision R に対し
A: DELETE
B: PUT
```

どちらか一方だけ成功。もう一方は 409。
同一 process 内では screenId 単位の直列化（既存 store 呼び出しを serialize）を推奨。

### DELETE vs Collector

候補 A 前提:

```text
DELETE 成功後
→ Description 無し
→ Collector は merge/write をスキップ
→ IMPLEMENTATION_ONLY 維持
```

DELETE 直前に Collector が更新した場合:

```text
revision が変わる
→ DELETE は 409
→ ユーザーは再読込して判断
```

### 外部 editor

filesystem 上の revision 確認と unlink の間には TOCTOU がある。
外部 editor との完全な排他は保証しない（現行 PUT と同じ限界）。
仕様上は「best-effort + expectedRevision」とし、Git 等の外部管理に委ねる。

---

## 14. DELETE API

### Endpoint

```http
DELETE /_jskim/spec/descriptions/{screenId}
```

新規コレクションは増やさない（既存 Descriptions リソース上の動詞追加）。

### revision の渡し方（推奨）

**JSON body:**

```json
{
  "expectedRevision": "sha256:..."
}
```

理由:

- 既存 PUT が `expectedRevision` を JSON body で渡している
- local server の JSON 読み取り・テストが容易
- `If-Match` はクォート規則や中間層の都合で揺れやすい
- query はログに残りやすい

`spec dev` 専用・same-origin・body size 制限は既存 POST/PUT に合わせる。

### 応答

成功（推奨）:

```http
200 OK
```

```json
{
  "screenId": "inquiry-input",
  "deleted": true
}
```

Viewer が fallback 判断に `deleted` / `screenId` を使える。`204` でもよいが、既存 API が JSON 本文を返す流れと揃えるなら 200 を優先。

主なエラー:

| 状況 | code 例 |
|------|---------|
| revision 不一致 | `SPEC_DESCRIPTION_REVISION_CONFLICT` 409 |
| ファイル無し | `SPEC_DESCRIPTION_NOT_FOUND` 404 |
| 未登録 screen | `SPEC_DESCRIPTION_SCREEN_NOT_FOUND` 404 |
| origin / method | 既存どおり 403 / 405 |

---

## 15. Viewer UI（実装は 7B-3B-3）

`jskim spec dev` の編集モードのみ。

| 状態 | action |
|------|--------|
| DESIGN_ONLY | 「画面設計を削除」 |
| LINKED | 「画面設計を削除」（実装は消えない旨を Dialog で明示） |
| IMPLEMENTATION_ONLY | action 無し |

Dialog は削除結果を文言で説明する（色だけに依存しない）。「削除」は Description に限定し、実装削除と混同しない。

---

## 16. dirty 状態

現在画面が dirty のときは削除しない。

```text
削除ボタン disabled
title / 案内:
画面設計を削除する前に、編集中の変更を保存またはキャンセルしてください。
```

画面複製（7B-3A）と同じ方針。dirty draft を確認なく捨てない。

---

## 17. route fallback

### DESIGN_ONLY を現在画面で削除

manifest rebuild 後、当該 route は消える。

推奨:

```text
manifest 上の次の screenId
→ 無ければ前の screenId
→ 0 件なら `/screens/_empty`（既存 empty state）
```

pending navigation（作成・複製）と衝突しないよう、削除時は削除対象の pending を clear する。

### LINKED を現在画面で削除

同じ `screenId` を維持し、status だけ `implementation-only` に更新。Preview は snapshot があれば継続。

### 他画面を削除

現在 route を維持。

固定 timeout 待ちは使わず、既存の manifest reload / pending パターンを再利用する。

---

## 18. watcher

Description 削除 event（実装後）:

```text
collect: 0
viewer build: 1
reload target=spec: 1
```

API は build を直接呼ばない（既存 Description 変更と同じ）。

| 結果 | 回数 |
|------|------|
| DESIGN_ONLY 削除成功 | build 1 / reload 1 / collect 0。画面数減少 |
| LINKED 削除成功 | build 1 / reload 1 / collect 0。同一 id・status 変更 |
| 409 / 404 | delete 0 / build 0 / reload 0 |

---

## 19. read-only

静的 Viewer / `jskim serve`:

```text
削除ボタン無し
DELETE API 無し
```

IMPLEMENTATION_ONLY の読み取り（GET draft / Preview）は現行どおり可能でなければならない。

---

## 20. archive / ORPHAN との違い

本機能は提供しない:

```text
archive
soft delete / trash
Viewer からの削除復元
ORPHAN 判定
source 削除
```

ファイルシステムや Git による手動復元は可能だが、製品機能としては扱わない。

---

## 21. 実装 Phase

### Phase 7B-3B-1 — Collector 方針（候補 A）【実装済み】

```text
missing Description では write しない
IMPLEMENTATION_ONLY 安定化
README / design-first / companion 文言 / 回帰テスト更新
```

削除 API / Viewer 削除 UI は **まだ未実装**（本 Phase の範囲外）。

### Phase 7B-3B-2 — Store / DELETE API

```text
FileDescriptionStore.delete(screenId, expectedRevision)
DELETE /_jskim/spec/descriptions/{screenId}
revision / race
watcher 回数
```

### Phase 7B-3B-3 — Viewer UI

```text
削除ボタン / 確認 Dialog
dirty 抑制
DESIGN_ONLY fallback
LINKED → IMPLEMENTATION_ONLY 表示
same-port integration / sample smoke
```

**一括実装は推奨しない。** Collector 変更（3B-1）を先に分離することで、削除 UI 無しでも IMPLEMENTATION_ONLY の意味が正しくなる。

---

## 22. リスク

| リスク | 内容 | 緩和 |
|--------|------|------|
| Breaking change | collect が Description を作らなくなる | 文書更新・テスト更新。初回 PUT 導線は既存 |
| 古い文書の誤解 | 「collect で draft 作成」記載が残る | 3B-1 で README / design-first を同時更新 |
| TOCTOU | revision 確認と unlink の間 | process 内直列化 + 409。外部 editor は保証外 |
| 削除後の即 collect | 方針未適用だと再 LINKED | 3B-1 を 3B-2/3 より先に必須化 |
| empty state | 最後の DESIGN_ONLY 削除 | `_empty` 既存経路を再利用 |

---

## 23. 未決事項

実装 Phase で確定すればよい細部:

1. DELETE 成功を `200 + JSON` にするか `204` にするか（本設計は 200 推奨）
2. process 内 screen lock の置き場（store 単体 vs orchestrator）
3. DESIGN_ONLY fallback の並び（manifest 配列順で十分か、localeCompare するか）
4. エラー code 名の最終文字列（`SPEC_DESCRIPTION_NOT_FOUND` 等）

方針そのもの（候補 A、削除対象、状態別契約）は本ドキュメントで確定とする。

---

## 24. 推奨案（まとめ）

1. **Collector は既存 Description にだけ merge/write する**（候補 A）。missing では新規作成しない。
2. **画面設計書削除 = Description JSON のみ削除**。実装・snapshot・resources は触らない。
3. **DESIGN_ONLY 削除 → 一覧から除去**。**LINKED 削除 → IMPLEMENTATION_ONLY 安定維持**。
4. **IMPLEMENTATION_ONLY には削除 action を出さない**（DELETE は 404）。
5. **初回 Description 永続化は Viewer PUT / POST / 複製のみ**。
6. **DELETE は `expectedRevision` 付き JSON body**。成功は 200 + `{ deleted: true }`。
7. **実装順は 7B-3B-1 → 7B-3B-2 → 7B-3B-3**。
8. archive / ORPHAN / source 削除 / trash 復元は非範囲。

---

## 付録 A. 最小シナリオ一覧

| シナリオ | 期待（方針適用後） |
|----------|-------------------|
| DESIGN_ONLY 削除 | Description 消滅。一覧から消える。fallback route |
| LINKED 削除 | Description 消滅。実装残る。IMPLEMENTATION_ONLY |
| IMPLEMENTATION_ONLY | 削除 UI 無し。DELETE 404 |
| DELETE vs PUT | 一方成功、他方 409 |
| DELETE vs Collector | DELETE 後 collect しても Description 再作成なし |
| 削除後 collect | snapshot 更新のみ。再 LINKED しない |
| 画面 0 件 | empty state |

---

## 付録 B. 調査で確認したコード位置（要約）

| 関心 | 位置 |
|------|------|
| collect 本体 | `jskim-screen-spec/src/collector/collect-screen-spec-project.ts` |
| missing → draft 生成 | `merge-description.ts`（`existing: null`） |
| ディスク書込 | `write-collected-description.ts` → `write-file-atomic.ts` |
| GET draft（非書込） | `file-description-store.ts` `read` / `buildMissingFileState` |
| 初回 PUT | `file-description-store.ts` `write` + `emptyRevision` |
| POST 作成 | `file-description-store.ts` `create` + `createFileAtomic` |
| 公開説明 | `jskim-screen-spec/README.md`、`docs/screen-spec/README.md` |

---

## 付録 C. filesystem 削除方式の比較（実装メモ）

| 方式 | 評価 |
|------|------|
| revision 確認後 `unlink` | 最小。TOCTOU あり。まずこれで足りる可能性が高い |
| screenId 単位 process lock | spec dev 内の PUT/DELETE/collect 競合に有効。外部 editor は不可 |
| quarantine rename → revision 再確認 → 削除 | より安全だが復元失敗パスが増える。初期実装では必須としない |

**初期推奨:** process 内直列化 + `expectedRevision` 確認後の unlink。quarantine は問題が出てから検討。

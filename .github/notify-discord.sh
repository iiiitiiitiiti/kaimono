#!/usr/bin/env bash
# 公開が済んだら、使う人に知らせたい変更を Discord に送る。deploy の流れの notify ジョブから呼ぶ。
# コミットの本文にある「お知らせ: 〜」の行だけを拾う。その行が1つも無い公開では送らない。
# 拾う範囲は「前に公開が成功したコミット」から今回まで。続けて push して前の公開が取り消されても、その分も拾う。
# 前に送った投稿を書き直すときは discord-edit の流れから呼ぶ（EDIT_NOTES を渡す）。
#
# 環境変数:
#   DISCORD_WEBHOOK_URL  送り先。GitHub のシークレットから渡す。空なら何もしない
#   APP_NAME             見出しに出すツールの名前
#   WORKFLOW_FILE        この流れのファイル名（前の成功を探すのに使う）
#   GH_TOKEN GITHUB_REPOSITORY GITHUB_SHA  GitHub Actions が渡す
#   COMMITS              前の成功が見つからないときに使う、この push のコミット（JSON）
#   ID_FILE              送れた投稿の番号を書き出すファイル（書き直しに使う）。空なら書き出さない
# 書き直すとき:
#   EDIT_NOTES    新しいお知らせの文。1行に1つ。頭の「お知らせ:」や「- 」は付けても付けなくてもよい
#   EDIT_MESSAGE  書き直す投稿の Discord のリンクか番号。空か last なら ID_ARTIFACT から最後に送った投稿を探す
#   ID_ARTIFACT   投稿の番号を残した Actions の成果物の名前
# 確かめるとき:
#   DRY_RUN=1  送らずに送る中身を出す
#   PREV_SHA   前の公開のコミットを指定する（空にすると「見つからない」ときの動きになる）
set -euo pipefail

URL=$(printf '%s' "${DISCORD_WEBHOOK_URL:-}" | tr -d '[:space:]')
if [ -z "$URL" ] && [ -z "${DRY_RUN:-}" ]; then
  echo "DISCORD_WEBHOOK_URL が無いので知らせません"
  # 書き直しは頼まれて動かすので、できなければ失敗にして気づけるようにする
  [ -n "${EDIT_NOTES+x}" ] && exit 1
  exit 0
fi

EDIT_ID=""
if [ -n "${EDIT_NOTES+x}" ]; then
  # 書き直す投稿の番号。リンク（…/channels/サーバー/チャンネル/投稿）なら最後の数字を使う
  TARGET=$(printf '%s' "${EDIT_MESSAGE:-}" | tr -d '[:space:]')
  if [ -z "$TARGET" ] || [ "$TARGET" = "last" ]; then
    ART=$(gh api "repos/$GITHUB_REPOSITORY/actions/artifacts?name=$ID_ARTIFACT&per_page=1" \
      --jq '.artifacts[0] | select(.expired == false) | .workflow_run.id' 2>/dev/null || true)
    if [ -z "$ART" ]; then
      echo "最後に送った投稿の番号が見つかりません。投稿のリンクを渡してください" >&2
      exit 1
    fi
    DIR=$(mktemp -d)
    gh run download "$ART" -R "$GITHUB_REPOSITORY" -n "$ID_ARTIFACT" -D "$DIR"
    TARGET=$(tr -d '[:space:]' < "$DIR/message-id.txt")
  fi
  EDIT_ID=$(printf '%s' "$TARGET" | sed -E 's#[?].*$##; s#/+$##; s#^.*/##')
  if ! printf '%s' "$EDIT_ID" | grep -Eq '^[0-9]{5,25}$'; then
    echo "投稿のリンクか番号として読めません: $TARGET" >&2
    exit 1
  fi
  # 書き直しは渡された文だけを使う。各行に「お知らせ: 」を付け、下の拾い方にそのまま通す
  LOG=$(printf '%s\n' "$EDIT_NOTES" | tr -d '\r' \
    | sed -E 's/^[[:space:]]*(お知らせ(:|：))?[[:space:]]*(-[[:space:]]+)?/お知らせ: /')
elif [ -n "${PREV_SHA+x}" ]; then
  PREV=$PREV_SHA
else
  PREV=$(gh run list -R "$GITHUB_REPOSITORY" --workflow "$WORKFLOW_FILE" --branch main \
    --status success -L 1 --json headSha --jq '.[0].headSha // ""')
fi

if [ -n "$EDIT_ID" ]; then
  :
elif [ -n "$PREV" ] && git merge-base --is-ancestor "$PREV" "$GITHUB_SHA" 2>/dev/null; then
  LOG=$(git log --reverse --format=%B "$PREV..$GITHUB_SHA")
else
  echo "前に成功した公開が見つからないので、この push のコミットだけを見ます"
  LOG=$(printf '%s' "${COMMITS:-[]}" | jq -r '(. // [])[].message')
fi

# 「お知らせ:」（全角の：も可）の後ろを拾い、同じ文は1回だけ、15行まで。
# Discord に飾りとして読まれる記号（* _ ~ ` | \）は逃がす
NOTES=$(printf '%s\n' "$LOG" \
  | jq -Rr 'capture("^\\s*お知らせ[:：]\\s*(?<t>.*\\S)")? | .t' \
  | awk '!seen[$0]++ && n++ < 15' \
  | jq -Rr 'gsub("(?<c>[\\\\*_~`|])"; "\\\(.c)") | "- " + .')

if [ -z "$NOTES" ]; then
  if [ -n "$EDIT_ID" ]; then
    echo "新しいお知らせの文が空なので書き直しません" >&2
    exit 1
  fi
  echo "お知らせの行が無いので知らせません"
  exit 0
fi

TEXT=$(printf '## %sを更新しました\n%s\n-# アプリを一度閉じて開き直すと新しい版になります' "$APP_NAME" "$NOTES")
PAYLOAD=$(jq -n --arg content "$TEXT" '{content: $content[:1900], allowed_mentions: {parse: []}}')

if [ -n "${DRY_RUN:-}" ]; then
  if [ -n "$EDIT_ID" ]; then echo "書き直す投稿: $EDIT_ID"; fi
  printf '%s\n' "$PAYLOAD"
  exit 0
fi

if [ -n "$EDIT_ID" ]; then
  # 書き直せるのは、このウェブフックが送った投稿だけ（ほかの投稿は Discord が断る）
  printf '%s' "$PAYLOAD" | curl -fsS --retry 3 -X PATCH -H "Content-Type: application/json" -d @- \
    "$URL/messages/$EDIT_ID" > /dev/null
  echo "Discord の投稿を書き直しました"
  exit 0
fi

RES=$(printf '%s' "$PAYLOAD" | curl -fsS --retry 3 -H "Content-Type: application/json" -d @- "$URL?wait=true")
echo "Discord に知らせました"
if [ -n "${ID_FILE:-}" ]; then
  printf '%s' "$RES" | jq -r '.id // empty' > "$ID_FILE"
fi

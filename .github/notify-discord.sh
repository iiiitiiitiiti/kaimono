#!/usr/bin/env bash
# 公開が済んだら、使う人に知らせたい変更を Discord に送る。deploy の流れの notify ジョブから呼ぶ。
# コミットの本文にある「お知らせ: 〜」の行だけを拾う。その行が1つも無い公開では送らない。
# 拾う範囲は「前に公開が成功したコミット」から今回まで。続けて push して前の公開が取り消されても、その分も拾う。
#
# 環境変数:
#   DISCORD_WEBHOOK_URL  送り先。GitHub のシークレットから渡す。空なら何もしない
#   APP_NAME             見出しに出すツールの名前
#   WORKFLOW_FILE        この流れのファイル名（前の成功を探すのに使う）
#   GH_TOKEN GITHUB_REPOSITORY GITHUB_SHA  GitHub Actions が渡す
#   COMMITS              前の成功が見つからないときに使う、この push のコミット（JSON）
# 確かめるとき:
#   DRY_RUN=1  送らずに送る中身を出す
#   PREV_SHA   前の公開のコミットを指定する（空にすると「見つからない」ときの動きになる）
set -euo pipefail

URL=$(printf '%s' "${DISCORD_WEBHOOK_URL:-}" | tr -d '[:space:]')
if [ -z "$URL" ] && [ -z "${DRY_RUN:-}" ]; then
  echo "DISCORD_WEBHOOK_URL が無いので知らせません"
  exit 0
fi

if [ -n "${PREV_SHA+x}" ]; then
  PREV=$PREV_SHA
else
  PREV=$(gh run list -R "$GITHUB_REPOSITORY" --workflow "$WORKFLOW_FILE" --branch main \
    --status success -L 1 --json headSha --jq '.[0].headSha // ""')
fi

if [ -n "$PREV" ] && git merge-base --is-ancestor "$PREV" "$GITHUB_SHA" 2>/dev/null; then
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
  echo "お知らせの行が無いので知らせません"
  exit 0
fi

TEXT=$(printf '## %sを更新しました\n%s\n-# アプリを一度閉じて開き直すと新しい版になります' "$APP_NAME" "$NOTES")
PAYLOAD=$(jq -n --arg content "$TEXT" '{content: $content[:1900], allowed_mentions: {parse: []}}')

if [ -n "${DRY_RUN:-}" ]; then
  printf '%s\n' "$PAYLOAD"
  exit 0
fi

printf '%s' "$PAYLOAD" | curl -fsS --retry 3 -H "Content-Type: application/json" -d @- "$URL" > /dev/null
echo "Discord に知らせました"

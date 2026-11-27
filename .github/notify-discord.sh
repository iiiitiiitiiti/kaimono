#!/usr/bin/env bash
# 公開が済んだら、使う人に知らせたい変更を Discord に送る。deploy の流れの notify ジョブから呼ぶ。
# コミットの本文にある「お知らせ: 〜」の行だけを拾う。その行が1つも無い公開では送らない。
# 拾う範囲は「前に公開が成功したコミット」から今回まで。続けて push して前の公開が取り消されても、その分も拾う。
# EDIT_MESSAGE を渡すと、新しく送らずに前の投稿を書き換える（edit-discord.yml から呼ぶ）。
#
# 環境変数:
#   DISCORD_WEBHOOK_URL  送り先。GitHub のシークレットから渡す。空なら何もしない
#   APP_NAME             見出しに出すツールの名前
#   WORKFLOW_FILE        この流れのファイル名（前の成功を探すのに使う）
#   GH_TOKEN GITHUB_REPOSITORY GITHUB_SHA  GitHub Actions が渡す
#   COMMITS              前の成功が見つからないときに使う、この push のコミット（JSON）
#   MESSAGE_ID_FILE      送った投稿の番号を書くファイル（あとで書き換えるために残す）。空なら書かない
# 書き換えるとき:
#   EDIT_MESSAGE  last（最後に送った投稿）か、Discord の「メッセージリンクをコピー」のリンクか、投稿の番号
#   NOTES_TEXT    書き換えた後の変わった点（1行に1つ）。前の文は引き継がないので、残す行もすべて書く
#   last は、notify ジョブが残した成果物 discord-message のうち一番新しいものから番号を読む
# 確かめるとき:
#   DRY_RUN=1        送らずに送る中身を出す
#   PREV_SHA         前の公開のコミットを指定する（空にすると「見つからない」ときの動きになる）
#   LAST_MESSAGE_ID  last のときに GitHub を見ずにこの番号を使う
set -euo pipefail

URL=$(printf '%s' "${DISCORD_WEBHOOK_URL:-}" | tr -d '[:space:]')
# URL の後ろの「?〜」（thread_id など）と末尾の / は分けておき、行き先ごとに付け直す
QUERY=""
case "$URL" in *\?*) QUERY=${URL#*\?}; URL=${URL%%\?*} ;; esac
URL=${URL%/}
EDIT=$(printf '%s' "${EDIT_MESSAGE:-}" | tr -d '[:space:]')
if [ -z "$URL" ] && [ -z "${DRY_RUN:-}" ]; then
  if [ -n "$EDIT" ]; then
    echo "DISCORD_WEBHOOK_URL が無いので書き換えられません" >&2
    exit 1
  fi
  echo "DISCORD_WEBHOOK_URL が無いので知らせません"
  exit 0
fi

# Discord に飾りとして読まれる記号（* _ ~ ` | \）を逃がし、箇条書きにする
to_bullets() {
  jq -Rr 'gsub("(?<c>[\\\\*_~`|])"; "\\\(.c)") | "- " + .' | tr -d '\r'
}

MSG_ID=""
if [ -n "$EDIT" ]; then
  if [ "$EDIT" = "last" ]; then
    if [ -n "${LAST_MESSAGE_ID+x}" ]; then
      MSG_ID=$LAST_MESSAGE_ID
    else
      RUN=$(gh api "repos/$GITHUB_REPOSITORY/actions/artifacts?name=discord-message&per_page=100" \
        --jq '[.artifacts[] | select(.expired | not)] | sort_by(.created_at) | last | .workflow_run.id // ""')
      if [ -n "$RUN" ]; then
        DIR=$(mktemp -d)
        gh run download "$RUN" -R "$GITHUB_REPOSITORY" -n discord-message -D "$DIR"
        MSG_ID=$(cat "$DIR"/* 2>/dev/null | tr -dc '0-9')
      fi
    fi
    if [ -z "$MSG_ID" ]; then
      echo "最後に送った投稿の記録が見つかりません。Discord の「メッセージリンクをコピー」のリンクを渡してください" >&2
      exit 2
    fi
  else
    # リンクの最後の番号が投稿の番号（https://discord.com/channels/サーバー/チャンネル/投稿）
    MSG_ID=$(printf '%s' "$EDIT" | sed 's/[?#].*//' | grep -oE '[0-9]{15,25}' | tail -n 1 || true)
    if [ -z "$MSG_ID" ]; then
      echo "書き換える投稿には last か、メッセージのリンクか番号を渡してください" >&2
      exit 2
    fi
  fi

  NOTES=$(printf '%s\n' "${NOTES_TEXT:-}" | tr -d '\r' \
    | sed -E 's/^[[:space:]]*(- )?[[:space:]]*//; s/[[:space:]]+$//' \
    | awk 'NF && !seen[$0]++ && n++ < 15' \
    | to_bullets)
  if [ -z "$NOTES" ]; then
    echo "書き換えた後の変わった点を1行以上渡してください" >&2
    exit 2
  fi
else
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

  # 「お知らせ:」（全角の：も可）の後ろを拾い、同じ文は1回だけ、15行まで
  NOTES=$(printf '%s\n' "$LOG" \
    | jq -Rr 'capture("^\\s*お知らせ[:：]\\s*(?<t>.*\\S)")? | .t' \
    | awk '!seen[$0]++ && n++ < 15' \
    | to_bullets)

  if [ -z "$NOTES" ]; then
    echo "お知らせの行が無いので知らせません"
    exit 0
  fi
fi

TEXT=$(printf '## %sを更新しました\n%s\n-# 1回開き直しただけでは新しいバージョンにならないことがあります\n-# バージョン更新のため、何度か開き直してください' "$APP_NAME" "$NOTES")
PAYLOAD=$(jq -n --arg content "$TEXT" '{content: $content[:1900], allowed_mentions: {parse: []}}')

RESP=$(mktemp)
NOT_FOUND="書き換える投稿が見つかりません（このツールの知らせとして送った投稿だけ書き換えられます）"
MSG_URL="$URL/messages/$MSG_ID${QUERY:+?$QUERY}"

# 書き換える前に、今の投稿の文を出す。番号だけでは、どの投稿を直すのかを見分けられないため
if [ -n "$MSG_ID" ] && [ -n "$URL" ]; then
  CODE=$(curl -sS --retry 3 -o "$RESP" -w '%{http_code}' "$MSG_URL")
  case "$CODE" in
    2??) echo "書き換える投稿（$MSG_ID）の今の文:"; jq -r '.content' "$RESP"; echo "----" ;;
    404) echo "$NOT_FOUND" >&2; exit 1 ;;
    *) echo "書き換える投稿を読めませんでした（$CODE）" >&2; exit 1 ;;
  esac
fi

if [ -n "${DRY_RUN:-}" ]; then
  if [ -n "$MSG_ID" ]; then
    echo "（書き換える投稿: $MSG_ID。書き換えた後の中身は次のとおり）"
  fi
  printf '%s\n' "$PAYLOAD"
  exit 0
fi

if [ -n "$MSG_ID" ]; then
  CODE=$(printf '%s' "$PAYLOAD" | curl -sS --retry 3 -X PATCH -o "$RESP" -w '%{http_code}' \
    -H "Content-Type: application/json" -d @- "$MSG_URL")
  case "$CODE" in
    2??) echo "Discord の投稿を書き換えました" ;;
    404) echo "$NOT_FOUND" >&2; exit 1 ;;
    *) echo "書き換えられませんでした（$CODE）" >&2; exit 1 ;;
  esac
  exit 0
fi

# wait=true で送った投稿の中身が返る。番号を残して、あとで書き換えられるようにする
CODE=$(printf '%s' "$PAYLOAD" | curl -sS --retry 3 -o "$RESP" -w '%{http_code}' \
  -H "Content-Type: application/json" -d @- "$URL?wait=true${QUERY:+&$QUERY}")
case "$CODE" in
  2??) ;;
  *) echo "送れませんでした（$CODE）" >&2; exit 1 ;;
esac
echo "Discord に知らせました"
NEW_ID=$(jq -r '.id // ""' "$RESP" 2>/dev/null || true)
if [ -n "${MESSAGE_ID_FILE:-}" ]; then
  if [ -n "$NEW_ID" ]; then
    printf '%s\n' "$NEW_ID" > "$MESSAGE_ID_FILE"
  else
    echo "送った投稿の番号が返ってこなかったので、last では書き換えられません（リンクなら書き換えられます）"
  fi
fi

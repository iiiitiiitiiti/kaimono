# かいもの

ふたりで同じ買い物リストを見て、足して、チェックするスマホ向けの Web アプリ。

- 公開先: https://iiiitiiitiiti.github.io/kaimono/ （リストを開くには鍵つきのリンクが要る）
- 保存先: Firebase Firestore（プロジェクト `kaimono-776d83`）
- 設計: [docs/DESIGN.md](docs/DESIGN.md)

## できること

- 足す・チェックしてかごへ移す・まとめて消す（取り消しつき）
- お店（スーパー・ドラッグストア・家電量販店など）ごとに並ぶ（品名から推測、直したお店は覚える）
- 「お店で絞る」を開くと、1つのお店の品物だけを出せる
- よく買う物を候補に出してワンタップで足す
- 誰が足したかを名前の色つきで出す
- 数量・メモ
- 店で電波が弱くても使える（つながったら送られる）
- 明るい表示と暗い表示の切り替え

## 開発

```bash
npm install
npm run lint
npm test
npm run build
npx vite preview --port 4317
```

ルールを変えたら `firebase deploy --only firestore:rules`（firebase-tools でログイン済みであること）。

main に push すると GitHub Actions が Pages へ公開する。

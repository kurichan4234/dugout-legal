// DUGOUT 大会運営（事務局向けの管理ページ）
// 権限はすべてサーバー（Supabase の RLS と関数）で確かめる。このページは表示と入力だけ。
"use strict";

const sb = supabase.createClient(DUGOUT_CONFIG.url, DUGOUT_CONFIG.key, {
  auth: { persistSession: true, storageKey: "dugout-admin" },
});

const state = { user: null, tab: "overview", data: null, organizer: false, thread: null };
const app = document.getElementById("app");

// ---------- 小道具 ----------

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (k === "value") el.value = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

function toast(text) {
  const t = document.getElementById("toast");
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 2600);
}

// サーバーのエラーを、利用者向けの文に
function errText(e) {
  const m = e?.message || String(e);
  if (/Invalid login credentials/i.test(m)) return "メールアドレスかパスワードが違います";
  if (/User already registered/i.test(m)) return "このメールアドレスはすでに登録されています。ログインしてください";
  if (/Password should be/i.test(m)) return "パスワードは6文字以上にしてください";
  if (/Email not confirmed/i.test(m)) return "メールアドレスの確認がまだです";
  return m;
}

async function rpc(name, params) {
  const { data, error } = await sb.rpc(name, params);
  if (error) throw error;
  return data;
}

async function run(fn, okText) {
  try {
    await fn();
    if (okText) toast(okText);
    await reload();
  } catch (e) {
    alertBox(errText(e));
  }
}

function alertBox(text) {
  const d = h("dialog", {}, h("p", {}, text), h("div", { class: "row" }, h("span", { class: "grow" }),
    h("button", { class: "primary", onclick: () => d.close() }, "OK")));
  document.body.append(d);
  d.addEventListener("close", () => d.remove());
  d.showModal();
}

function confirmBox(text, okLabel = "OK") {
  return new Promise((resolve) => {
    const d = h("dialog", {}, h("p", {}, text), h("div", { class: "row" }, h("span", { class: "grow" }),
      h("button", { onclick: () => { d.close(); resolve(false); } }, "キャンセル"),
      h("button", { class: "primary", onclick: () => { d.close(); resolve(true); } }, okLabel)));
    document.body.append(d);
    d.addEventListener("close", () => d.remove());
    d.showModal();
  });
}

const pad = (n) => String(n).padStart(2, "0");
const wd = ["日", "月", "火", "水", "木", "金", "土"];
function fmtDate(iso) {
  if (!iso) return "未定";
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}(${wd[d.getDay()]}) ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function dateValue(iso) { if (!iso) return ""; const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function timeValue(iso) { if (!iso) return ""; const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function toISO(date, time) { if (!date) return null; return new Date(`${date}T${time || "09:00"}`).toISOString(); }

const ballLabel = (b) => (b === "hard" ? "硬式" : "軟式");
const statusLabel = { entry: "エントリー受付中", ongoing: "開催中", finished: "終了" };

function params() { return new URLSearchParams(location.hash.slice(1)); }
function go(hash) { location.hash = hash; }
window.addEventListener("hashchange", () => render());

// ---------- 読み込み ----------

async function reload() {
  const t = params().get("t");
  if (!t) { state.data = null; return render(); }
  const { data, error } = await sb.from("tournaments")
    .select("*, tournament_staff(*), tournament_teams(*, tournament_team_contacts(*)), tournament_matches(*), tournament_secrets(staff_code)")
    .eq("id", t).maybeSingle();
  if (error) return alertBox(errText(error));
  const { data: msgs } = await sb.from("tournament_messages").select("*").eq("tournament_id", t).order("created_at");
  state.data = data ? { ...data, messages: msgs || [] } : null;
  render();
}

// ---------- 画面 ----------

async function render() {
  const who = document.getElementById("who");
  who.replaceChildren();
  if (!state.user) return renderLogin();
  who.append(h("span", {}, state.user.email || ""), h("button", { class: "small", onclick: () => sb.auth.signOut() }, "ログアウト"));
  const t = params().get("t");
  if (t) {
    if (!state.data || state.data.id !== t) {
      app.replaceChildren(h("p", { class: "loading" }, "読み込み中…"));
      return reload();
    }
    return renderTournament();
  }
  return renderHome();
}

function renderLogin() {
  let mode = "login";
  const email = h("input", { type: "email", placeholder: "メールアドレス", autocomplete: "username" });
  const pw = h("input", { type: "password", placeholder: "パスワード（6文字以上）", autocomplete: "current-password" });
  const err = h("p", { class: "error" });
  const title = h("h1", {}, "ログイン");
  const btn = h("button", { class: "primary", style: "width:100%" }, "ログイン");
  const toggle = h("button", { style: "width:100%" }, "はじめての方（アカウントを作る）");
  toggle.onclick = () => {
    mode = mode === "login" ? "signup" : "login";
    title.textContent = mode === "login" ? "ログイン" : "アカウントを作る";
    btn.textContent = mode === "login" ? "ログイン" : "アカウントを作る";
    toggle.textContent = mode === "login" ? "はじめての方（アカウントを作る）" : "アカウントをお持ちの方（ログイン）";
    pw.autocomplete = mode === "login" ? "current-password" : "new-password";
  };
  btn.onclick = async () => {
    err.textContent = "";
    btn.disabled = true;
    try {
      const creds = { email: email.value.trim(), password: pw.value };
      const { data, error } = mode === "login" ? await sb.auth.signInWithPassword(creds) : await sb.auth.signUp(creds);
      if (error) throw error;
      if (mode === "signup" && !data.session) err.textContent = "確認メールを送りました。メールのリンクを開いてからログインしてください";
    } catch (e) { err.textContent = errText(e); }
    btn.disabled = false;
  };
  app.replaceChildren(h("div", { class: "card login" },
    title,
    h("p", { class: "sub" }, "大会の事務局（運営スタッフ）のためのページです。チームの登録、試合の組み合わせ・日程、出場確認、結果の入力ができます。"),
    h("div", { style: "display:grid;gap:10px;margin-top:12px" }, email, pw, btn, toggle, err)));
}

async function renderHome() {
  state.organizer = await rpc("is_organizer").catch(() => false);
  const { data: list } = await sb.from("tournaments").select("id, name, ball_type, prefecture, area, status, tournament_staff(user_id, role)")
    .order("created_at", { ascending: false });
  const mine = (list || []).filter((t) => t.tournament_staff.some((s) => s.user_id === state.user.id));

  const staffCode = h("input", { placeholder: "スタッフコード（8文字）" });
  const staffName = h("input", { placeholder: "表示する名前（例：港区軟式野球連盟 山田）" });
  const orgCode = h("input", { placeholder: "主催者の招待コード（8文字）" });

  app.replaceChildren(
    h("h1", {}, "運営している大会"),
    h("div", { class: "card list", style: "padding:0" },
      mine.length ? mine.map((t) => h("a", { href: `#t=${t.id}` },
        h("strong", {}, t.name), " ",
        h("span", { class: "tag" }, ballLabel(t.ball_type)), " ",
        h("span", { class: "tag" }, statusLabel[t.status]), " ",
        h("span", { class: "sub" }, `${t.prefecture} ${t.area}`)))
        : h("p", { style: "padding:14px", class: "muted" }, "まだありません。スタッフコードで加わるか、大会を作ってください。")),
    h("div", { class: "grid2" },
      h("div", { class: "card" },
        h("h2", { style: "margin-top:0" }, "運営スタッフとして加わる"),
        h("p", { class: "sub" }, "大会の責任者から届いたスタッフコードを入れてください。"),
        h("div", { style: "display:grid;gap:8px" }, staffCode, staffName,
          h("button", { class: "primary", onclick: () => run(async () => {
            const id = await rpc("join_tournament_staff", { p_code: staffCode.value.trim(), p_name: staffName.value.trim() });
            go(`t=${id}`);
          }, "運営スタッフに加わりました") }, "加わる"))),
      state.organizer ? createCard() : h("div", { class: "card" },
        h("h2", { style: "margin-top:0" }, "大会を主催する"),
        h("p", { class: "sub" }, "大会を作るには、DUGOUT運営事務局が発行する主催者の招待コードが必要です。"),
        h("div", { style: "display:grid;gap:8px" }, orgCode,
          h("button", { class: "primary", onclick: () => run(() => rpc("become_organizer", { p_code: orgCode.value.trim() }), "大会を作れるようになりました") }, "登録")))));
}

function createCard() {
  const name = h("input", { placeholder: "例：港区軟式野球 秋季大会" });
  const ball = h("select", {}, h("option", { value: "rubber" }, "軟式"), h("option", { value: "hard" }, "硬式"));
  const pref = h("input", { placeholder: "都道府県（例：東京都）", value: "東京都" });
  const area = h("input", { placeholder: "市区町村（任意）" });
  const format = h("select", {}, h("option", { value: "knockout" }, "トーナメント"), h("option", { value: "league" }, "リーグ（総当たり）"));
  const days = h("input", { type: "number", min: 1, max: 14, value: 3 });
  const me = h("input", { placeholder: "あなたの名前（運営スタッフとして表示）" });
  return h("div", { class: "card" },
    h("h2", { style: "margin-top:0" }, "大会を作る"),
    h("div", { style: "display:grid;gap:8px" },
      h("label", { class: "field" }, "大会名", name),
      h("div", { class: "row" }, h("label", { class: "field grow" }, "軟式・硬式", ball), h("label", { class: "field grow" }, "形式", format)),
      h("div", { class: "row" }, h("label", { class: "field grow" }, "都道府県", pref), h("label", { class: "field grow" }, "市区町村", area)),
      h("label", { class: "field" }, "出場確認の期限（試合の何日前まで）", days),
      h("label", { class: "field" }, "あなたの名前", me),
      h("button", { class: "primary", onclick: () => run(async () => {
        const id = await rpc("create_tournament", {
          p_name: name.value.trim(), p_ball: ball.value, p_prefecture: pref.value.trim(), p_area: area.value.trim(),
          p_format: format.value, p_confirm_days: Number(days.value) || 3, p_note: "", p_my_name: me.value.trim(),
        });
        go(`t=${id}`);
      }, "大会を作りました") }, "作成")));
}

// ---------- 大会 ----------

function entries() { return [...state.data.tournament_teams].sort((a, b) => (a.seed ?? 9999) - (b.seed ?? 9999) || a.created_at.localeCompare(b.created_at)); }
function entryName(id) { return state.data.tournament_teams.find((e) => e.id === id)?.team_name ?? "未定"; }
function contact(e) { const c = e.tournament_team_contacts; return (Array.isArray(c) ? c[0] : c) || {}; }
function matches() { return [...state.data.tournament_matches].sort((a, b) => a.round - b.round || a.position - b.position); }
function deadline(m) { return m.starts_at ? new Date(new Date(m.starts_at).getTime() - state.data.confirm_days * 86400000) : null; }
function isOwner() { return state.data.tournament_staff.some((s) => s.user_id === state.user.id && s.role === "owner"); }

function unconfirmed() {
  const list = [];
  for (const m of matches()) {
    if (m.status !== "scheduled" || !m.starts_at || new Date(m.starts_at) < new Date()) continue;
    for (const side of ["home", "away"]) {
      const entry = m[`${side}_entry`];
      if (entry && !m[`${side}_confirmed_at`]) list.push({ m, side, entry });
    }
  }
  return list;
}

function renderTournament() {
  const t = state.data;
  const tabs = [
    ["overview", "概要"], ["teams", `チーム（${t.tournament_teams.length}）`], ["matches", "試合・日程"],
    ["confirm", "出場確認"], ["results", "結果"], ["bracket", "組み合わせ表"], ["messages", "連絡"],
  ];
  const overdue = unconfirmed().filter((u) => deadline(u.m) < new Date()).length;
  const tabBar = h("div", { class: "tabs" }, tabs.map(([k, label]) =>
    h("button", { class: state.tab === k ? "on" : "", onclick: () => { state.tab = k; render(); } },
      label, k === "confirm" && overdue ? h("span", { class: "badge" }, overdue) : null)));
  const body = { overview, teams, matches: matchesTab, confirm: confirmTab, results, bracket, messages }[state.tab]();
  app.replaceChildren(
    h("p", { class: "sub" }, h("a", { href: "#" }, "← 大会の一覧")),
    h("h1", {}, t.name),
    h("div", { class: "row sub" }, h("span", { class: "tag" }, ballLabel(t.ball_type)), h("span", { class: "tag" }, statusLabel[t.status]),
      `${t.prefecture} ${t.area}`, "・運営：" + t.tournament_staff.map((s) => s.name).join("、")),
    tabBar, body);
}

function overview() {
  const t = state.data;
  const secret = Array.isArray(t.tournament_secrets) ? t.tournament_secrets[0] : t.tournament_secrets;
  const publicURL = new URL(`../t/#${t.public_code}`, location.href).href;
  const name = h("input", { value: t.name });
  const area = h("input", { value: t.area });
  const days = h("input", { type: "number", min: 1, max: 14, value: t.confirm_days });
  const status = h("select", {}, Object.entries(statusLabel).map(([k, v]) => h("option", { value: k, selected: t.status === k }, v)));
  const note = h("textarea", { placeholder: "参加チームへのお知らせ（雨天時の連絡方法など）" }, t.note);
  return h("div", {},
    h("div", { class: "grid2" },
      codeCard("エントリーコード", t.entry_code, "DUGOUTを使っている参加チームの管理者に送ります。アプリの「チーム」→「大会」→「エントリーコードで参加」で入れると、事務局が登録したチームとつながり、試合が予定に入ります。"),
      codeCard("スタッフコード", secret?.staff_code ?? "（責任者・スタッフにだけ表示）", "一緒に運営する人にだけ送ります。担当者が変わっても大会が止まらないよう、2人以上で運営しましょう。"),
      h("div", { class: "card" }, h("div", { class: "sub" }, "公開ページ（ログインなしで誰でも見られる組み合わせ表・日程）"),
        h("p", {}, h("a", { href: publicURL, target: "_blank" }, publicURL)),
        h("button", { class: "small", onclick: () => navigator.clipboard.writeText(publicURL).then(() => toast("コピーしました")) }, "URLをコピー"))),
    t.tournament_staff.length < 2 ? h("p", { class: "card", style: "color:var(--orange)" },
      "⚠️ 運営スタッフが1人だけです。スタッフコードを送って、もう1人以上加えておきましょう。") : null,
    h("h2", {}, "大会の情報"),
    h("div", { class: "card", style: "display:grid;gap:10px" },
      h("label", { class: "field" }, "大会名", name),
      h("div", { class: "row" }, h("label", { class: "field grow" }, "市区町村", area),
        h("label", { class: "field" }, "出場確認の期限（何日前）", days), h("label", { class: "field" }, "状態", status)),
      h("label", { class: "field" }, "参加チームへのお知らせ", note),
      h("div", { class: "row" }, h("span", { class: "grow" }),
        h("button", { class: "primary", onclick: () => run(() => rpc("update_tournament", {
          p_t: t.id, p_name: name.value.trim(), p_area: area.value.trim(), p_confirm_days: Number(days.value) || 3,
          p_note: note.value.trim(), p_status: status.value,
        }), "保存しました") }, "保存"))),
    h("h2", {}, "運営スタッフ"),
    h("div", { class: "card" }, t.tournament_staff.map((s) => h("div", { class: "row", style: "padding:4px 0" },
      h("span", { class: "grow" }, s.name, s.role === "owner" ? h("span", { class: "tag", style: "margin-left:6px" }, "責任者") : null,
        s.user_id === state.user.id ? h("span", { class: "sub" }, "（あなた）") : null),
      t.tournament_staff.length > 1 && (s.user_id === state.user.id || isOwner())
        ? h("button", { class: "small danger", onclick: async () => {
            if (await confirmBox(`${s.name}さんを運営スタッフから外しますか？`, "外す")) {
              run(() => rpc("remove_tournament_staff", { p_t: t.id, p_user: s.user_id }), "外しました");
            }
          } }, s.user_id === state.user.id ? "抜ける" : "外す") : null))),
    isOwner() ? h("div", { class: "card" }, h("button", { class: "danger", onclick: async () => {
      if (await confirmBox(`「${t.name}」を削除しますか？チーム・試合・連絡もすべて消え、元に戻せません。`, "削除する")) {
        try { await rpc("delete_tournament", { p_t: t.id }); toast("削除しました"); go(""); } catch (e) { alertBox(errText(e)); }
      }
    } }, "この大会を削除")) : null);
}

function codeCard(title, code, note) {
  return h("div", { class: "card" }, h("div", { class: "sub" }, title), h("div", { class: "code" }, code),
    h("p", { class: "sub" }, note),
    h("button", { class: "small", onclick: () => navigator.clipboard.writeText(code).then(() => toast("コピーしました")) }, "コピー"));
}

// ---------- チーム ----------

function teams() {
  const t = state.data;
  const rows = entries().map((e) => teamRow(e));
  const blank = teamRow(null);
  return h("div", {},
    h("p", { class: "sub" }, "参加チームを登録します。DUGOUTを使っていないチームも登録できます。代表者・副代表の連絡先は運営スタッフにだけ見えます（担当者が変わっても途切れないよう、2人分登録しておくと安心です）。"),
    h("div", { class: "scroll" }, h("table", {},
      h("thead", {}, h("tr", {}, ["シード", "チーム名", "DUGOUT", "代表者", "代表 電話", "副代表", "副代表 電話", "メール", "メモ", ""].map((x) => h("th", {}, x)))),
      h("tbody", {}, rows, blank))),
    h("p", { class: "sub" }, `${t.tournament_teams.length}チーム登録済み。最後の行に入力して「追加」で登録します。`));
}

function teamRow(e) {
  const c = e ? contact(e) : {};
  const f = {
    seed: h("input", { type: "number", min: 1, style: "width:60px", value: e?.seed ?? "" }),
    name: h("input", { placeholder: "チーム名", value: e?.team_name ?? "" }),
    rep: h("input", { value: c.rep_name ?? "" }), repTel: h("input", { type: "tel", value: c.rep_phone ?? "" }),
    sub: h("input", { value: c.sub_name ?? "" }), subTel: h("input", { type: "tel", value: c.sub_phone ?? "" }),
    email: h("input", { type: "email", value: c.email ?? "" }), memo: h("input", { value: c.memo ?? "" }),
  };
  const save = () => run(() => rpc("save_entry", {
    p_id: e?.id ?? null, p_t: state.data.id, p_name: f.name.value.trim(), p_seed: f.seed.value ? Number(f.seed.value) : null,
    p_rep_name: f.rep.value, p_rep_phone: f.repTel.value, p_sub_name: f.sub.value, p_sub_phone: f.subTel.value,
    p_email: f.email.value, p_memo: f.memo.value,
  }), e ? "保存しました" : "追加しました");
  return h("tr", {},
    h("td", {}, f.seed), h("td", {}, f.name),
    h("td", {}, e ? (e.team_id ? h("span", { class: "tag app" }, "連携済み") : h("span", { class: "tag" }, "未使用")) : ""),
    h("td", {}, f.rep), h("td", {}, f.repTel), h("td", {}, f.sub), h("td", {}, f.subTel), h("td", {}, f.email), h("td", {}, f.memo),
    h("td", {}, h("div", { class: "row", style: "flex-wrap:nowrap" },
      h("button", { class: e ? "small" : "small primary", onclick: save }, e ? "保存" : "追加"),
      e ? h("button", { class: "small danger", onclick: async () => {
        if (await confirmBox(`「${e.team_name}」を大会から外しますか？決まっていない試合からも外れます。`, "外す")) {
          run(() => rpc("delete_entry", { p_entry: e.id }), "外しました");
        }
      } }, "外す") : null)));
}

// ---------- 試合・日程 ----------

function matchesTab() {
  const t = state.data;
  const list = matches().filter((m) => !(m.status === "forfeit" && (!m.home_entry || !m.away_entry)));
  return h("div", {},
    h("div", { class: "row" },
      h("button", { class: "primary", onclick: () => addRows(1) }, "＋ 試合を追加"),
      h("button", { onclick: () => addRows(5) }, "＋ 5試合まとめて追加"),
      h("span", { class: "grow" }),
      h("button", { onclick: async () => {
        const ok = await confirmBox(t.tournament_matches.length
          ? "今の試合を消して、登録チームで組み合わせを作り直しますか？（入れた日程も消えます）"
          : `登録チーム${t.tournament_teams.length}チームで、${t.format === "league" ? "総当たり" : "トーナメント"}の組み合わせを作りますか？（シード順）`, "作る");
        if (ok) run(() => rpc("generate_matches", { p_t: t.id, p_shuffle: false }), "組み合わせを作りました");
      } }, "組み合わせを自動で作る")),
    h("p", { class: "sub" }, "各行を入力して「保存」すると、DUGOUTを使っているチームの予定に試合が入ります。日時・会場・対戦を変えると、出場確認はやり直しになります。"),
    h("div", { class: "scroll" }, h("table", {},
      h("thead", {}, h("tr", {}, ["回戦", "試合名", "先攻（ホーム）", "後攻（ビジター）", "日付", "開始", "会場", "メモ", ""].map((x) => h("th", {}, x)))),
      h("tbody", {}, list.length ? list.map((m) => matchRow(m)) : h("tr", {}, h("td", { colspan: 9, class: "muted" }, "まだ試合がありません"))))));
}

async function addRows(n) {
  const t = state.data;
  const maxPos = Math.max(0, ...t.tournament_matches.map((m) => m.position));
  await run(async () => {
    for (let i = 1; i <= n; i++) {
      await rpc("save_match", { p_id: null, p_t: t.id, p_round: 1, p_position: maxPos + i, p_label: `第${maxPos + i}試合`,
        p_home: null, p_away: null, p_starts_at: null, p_venue: "", p_note: "" });
    }
  }, n > 1 ? `${n}試合追加しました` : "試合を追加しました");
}

function entrySelect(value) {
  return h("select", {}, h("option", { value: "" }, "未定"),
    entries().map((e) => h("option", { value: e.id, selected: e.id === value }, e.team_name)));
}

function matchRow(m) {
  const f = {
    round: h("input", { type: "number", min: 1, max: 20, style: "width:56px", value: m.round }),
    label: h("input", { value: m.label }),
    home: entrySelect(m.home_entry), away: entrySelect(m.away_entry),
    date: h("input", { type: "date", value: dateValue(m.starts_at) }),
    time: h("input", { type: "time", value: timeValue(m.starts_at), step: 300 }),
    venue: h("input", { value: m.venue, placeholder: "会場" }), note: h("input", { value: m.note }),
  };
  const locked = m.status === "done" || m.status === "forfeit";
  if (locked) Object.values(f).forEach((x) => (x.disabled = true));
  return h("tr", {},
    h("td", {}, f.round), h("td", {}, f.label), h("td", {}, f.home), h("td", {}, f.away),
    h("td", {}, f.date), h("td", {}, f.time), h("td", {}, f.venue), h("td", {}, f.note),
    h("td", {}, locked ? h("span", { class: "tag ok" }, "結果入力済み") : h("div", { class: "row", style: "flex-wrap:nowrap" },
      h("button", { class: "small primary", onclick: () => run(() => rpc("save_match", {
        p_id: m.id, p_t: state.data.id, p_round: Number(f.round.value) || 1, p_position: m.position, p_label: f.label.value.trim(),
        p_home: f.home.value || null, p_away: f.away.value || null, p_starts_at: toISO(f.date.value, f.time.value),
        p_venue: f.venue.value.trim(), p_note: f.note.value.trim(),
      }), "保存しました") }, "保存"),
      h("button", { class: "small danger", onclick: async () => {
        if (await confirmBox(`「${m.label || "この試合"}」を削除しますか？チームの予定からも消えます。`, "削除する")) {
          run(() => rpc("delete_match", { p_match: m.id }), "削除しました");
        }
      } }, "削除"))));
}

// ---------- 出場確認 ----------

function confirmTab() {
  const list = matches().filter((m) => m.status === "scheduled" && m.starts_at && m.home_entry && m.away_entry);
  const now = new Date();
  const missing = unconfirmed();
  return h("div", {},
    h("p", { class: "sub" }, `試合の${state.data.confirm_days}日前までに、各チームが出場を確認します。DUGOUTを使っているチームはアプリで、使っていないチームは事務局が電話などで確かめて「確認済みにする」を押してください。期限を過ぎると、チームの全員と運営スタッフに通知が届きます。`),
    missing.length ? h("div", { class: "card" }, h("strong", {}, `未確認 ${missing.length}件`), h("ul", {}, missing.map(({ m, side, entry }) => {
      const e = state.data.tournament_teams.find((x) => x.id === entry);
      const c = e ? contact(e) : {};
      const late = deadline(m) < now;
      return h("li", {}, h("span", { class: late ? "tag bad" : "tag warn" }, late ? "期限切れ" : "未確認"), " ",
        `${fmtDate(m.starts_at)} ${m.label}：`, h("strong", {}, entryName(entry)),
        c.rep_name || c.rep_phone ? `　代表 ${c.rep_name ?? ""} ${c.rep_phone ?? ""}` : "",
        c.sub_name || c.sub_phone ? `　副代表 ${c.sub_name ?? ""} ${c.sub_phone ?? ""}` : "");
    }))) : h("p", { class: "card" }, "✅ 未確認のチームはありません"),
    h("div", { class: "scroll" }, h("table", {},
      h("thead", {}, h("tr", {}, ["日時", "試合", "期限", "先攻", "", "後攻", ""].map((x) => h("th", {}, x)))),
      h("tbody", {}, list.map((m) => {
        const late = deadline(m) < now;
        const cell = (side) => {
          const at = m[`${side}_confirmed_at`];
          return [h("td", {}, entryName(m[`${side}_entry`]), h("br"),
            at ? h("span", { class: "tag ok" }, "確認済み") : h("span", { class: late ? "tag bad" : "tag warn" }, late ? "期限切れ" : "未確認"),
            at ? h("div", { class: "sub" }, m[`${side}_confirmed_by`] ?? "") : null),
          h("td", {}, at
            ? h("button", { class: "small", onclick: () => run(() => rpc("staff_confirm_match", { p_match: m.id, p_side: side, p_confirm: false, p_note: "" }), "取り消しました") }, "取り消す")
            : h("button", { class: "small primary", onclick: async () => {
                const note = prompt("確認した方法（任意。例：電話で代表に確認）", "電話で確認");
                if (note === null) return;
                run(() => rpc("staff_confirm_match", { p_match: m.id, p_side: side, p_confirm: true, p_note: note }), "確認済みにしました");
              } }, "確認済みにする"))];
        };
        return h("tr", {}, h("td", {}, fmtDate(m.starts_at)), h("td", {}, m.label),
          h("td", {}, h("span", { class: late ? "tag bad" : "tag" }, fmtDate(deadline(m).toISOString()))), ...cell("home"), ...cell("away"));
      })))));
}

// ---------- 結果 ----------

function results() {
  const list = matches().filter((m) => m.home_entry && m.away_entry && m.status !== "cancelled");
  return h("div", {},
    h("p", { class: "sub" }, "点数を入れて「保存」すると、トーナメントでは勝ったチームが次の試合に進みます。棄権・無断欠席は「棄権」を選んでください。"),
    h("div", { class: "scroll" }, h("table", {},
      h("thead", {}, h("tr", {}, ["試合", "日時", "先攻", "点", "点", "後攻", "棄権", ""].map((x) => h("th", {}, x)))),
      h("tbody", {}, list.length ? list.map((m) => {
        const hs = h("input", { type: "number", min: 0, max: 99, style: "width:64px", value: m.home_score ?? "" });
        const as = h("input", { type: "number", min: 0, max: 99, style: "width:64px", value: m.away_score ?? "" });
        const fo = h("select", {}, h("option", { value: "" }, "なし"),
          h("option", { value: "home", selected: m.status === "forfeit" && m.winner_entry === m.away_entry }, `${entryName(m.home_entry)}が棄権`),
          h("option", { value: "away", selected: m.status === "forfeit" && m.winner_entry === m.home_entry }, `${entryName(m.away_entry)}が棄権`));
        const done = m.status === "done" || m.status === "forfeit";
        return h("tr", {},
          h("td", {}, m.label), h("td", {}, fmtDate(m.starts_at)),
          h("td", { class: m.winner_entry === m.home_entry && done ? "" : "" }, entryName(m.home_entry), m.winner_entry === m.home_entry && done ? " 👑" : ""),
          h("td", {}, hs), h("td", {}, as),
          h("td", {}, entryName(m.away_entry), m.winner_entry === m.away_entry && done ? " 👑" : ""),
          h("td", {}, fo),
          h("td", {}, h("div", { class: "row", style: "flex-wrap:nowrap" },
            h("button", { class: "small primary", onclick: () => run(() => rpc("record_result", {
              p_match: m.id, p_home_score: fo.value ? null : (hs.value === "" ? null : Number(hs.value)),
              p_away_score: fo.value ? null : (as.value === "" ? null : Number(as.value)), p_forfeit: fo.value || null,
            }), "結果を保存しました") }, "保存"),
            done ? h("button", { class: "small", onclick: () => run(() => rpc("clear_result", { p_match: m.id }), "取り消しました") }, "取り消す") : null)));
      }) : h("tr", {}, h("td", { colspan: 8, class: "muted" }, "対戦が決まった試合がありません"))))));
}

// ---------- 組み合わせ表 ----------

function bracket() {
  const t = state.data;
  return h("div", {}, bracketView(t, matches(), entryName),
    h("p", { class: "sub" }, "公開ページ（概要タブのURL）でも、同じ表をログインなしで見られます。"));
}

function bracketView(t, ms, nameOf) {
  if (!ms.length) return h("p", { class: "card muted" }, "まだ試合がありません");
  if (t.format === "league") {
    const table = new Map((t.tournament_teams || t.teams).map((e) => [e.id, { name: e.team_name ?? e.name, w: 0, l: 0, d: 0, p: 0 }]));
    for (const m of ms) {
      if (!(m.status === "done" || m.status === "forfeit")) continue;
      const a = table.get(m.home_entry ?? m.home), b = table.get(m.away_entry ?? m.away);
      const win = m.winner_entry ?? m.winner;
      if (!a || !b) continue;
      if (win === (m.home_entry ?? m.home)) { a.w++; b.l++; a.p += 3; } else if (win === (m.away_entry ?? m.away)) { b.w++; a.l++; b.p += 3; } else { a.d++; b.d++; a.p++; b.p++; }
    }
    const rows = [...table.values()].sort((x, y) => y.p - x.p);
    return h("table", {}, h("thead", {}, h("tr", {}, ["順位", "チーム", "勝", "負", "分", "勝ち点"].map((x) => h("th", {}, x)))),
      h("tbody", {}, rows.map((r, i) => h("tr", {}, h("td", {}, i + 1), h("td", {}, r.name), h("td", {}, r.w), h("td", {}, r.l), h("td", {}, r.d), h("td", {}, h("strong", {}, r.p))))));
  }
  const rounds = [...new Set(ms.map((m) => m.round))].sort((a, b) => a - b);
  const last = rounds[rounds.length - 1];
  return h("div", { class: "bracket" }, rounds.map((r) => h("div", { class: "round" },
    h("h3", {}, r === last ? "決勝" : r === last - 1 ? "準決勝" : `${r}回戦`),
    ms.filter((m) => m.round === r).map((m) => {
      const home = m.home_entry ?? m.home, away = m.away_entry ?? m.away, win = m.winner_entry ?? m.winner;
      const done = m.status === "done" || m.status === "forfeit";
      const line = (id, score) => h("div", { class: done && win === id ? "win" : "" }, h("span", {}, id ? nameOf(id) : "未定"), h("span", {}, done && score != null ? score : ""));
      return h("div", { class: "bm" }, line(home, m.home_score), line(away, m.away_score),
        h("div", { class: "when" }, done && (!home || !away) ? "不戦勝" : m.starts_at ? `${fmtDate(m.starts_at)} ${m.venue || ""}` : ""));
    }))));
}

// ---------- 連絡 ----------

function messages() {
  const t = state.data;
  const threads = [{ id: null, name: "全チームへのお知らせ" }, ...entries().filter((e) => e.team_id).map((e) => ({ id: e.team_id, name: e.team_name }))];
  if (!threads.some((x) => x.id === state.thread)) state.thread = null;
  const msgs = t.messages.filter((m) => (m.team_id ?? null) === state.thread);
  const box = h("textarea", { placeholder: state.thread ? "このチームへのメッセージ" : "全チームへのお知らせ（DUGOUTの参加チーム全員に通知が届きます）" });
  return h("div", {},
    h("p", { class: "sub" }, "DUGOUTを使っているチームに、アプリの通知で届きます。DUGOUTを使っていないチームには、チームタブの連絡先から連絡してください。"),
    h("div", { class: "row" }, threads.map((th) => h("button", { class: state.thread === th.id ? "primary small" : "small", onclick: () => { state.thread = th.id; render(); } }, th.name))),
    h("div", { class: "card" },
      msgs.length ? msgs.map((m) => h("div", { class: `msg ${m.from_staff ? "staff" : "team"}` },
        h("div", { class: "who" }, `${m.sender_name}・${fmtDate(m.created_at)}`), m.body)) : h("p", { class: "muted" }, "まだありません"),
      h("div", { style: "display:grid;gap:8px;margin-top:10px" }, box,
        h("div", { class: "row" }, h("span", { class: "grow" }),
          h("button", { class: "primary", onclick: () => {
            if (!box.value.trim()) return;
            run(() => rpc("send_tournament_message", { p_t: t.id, p_team: state.thread, p_body: box.value.trim() }), "送信しました");
          } }, "送信")))));
}

// ---------- はじめに ----------

sb.auth.onAuthStateChange((_event, session) => {
  const before = state.user?.id;
  state.user = session?.user ?? null;
  if (state.user?.id !== before) { state.data = null; render(); }
});
sb.auth.getSession().then(({ data }) => { state.user = data.session?.user ?? null; render(); });

// ほかのスタッフ・チームの変更を取り込む
sb.channel("admin").on("postgres_changes", { event: "*", schema: "public" }, (p) => {
  if (state.data && /^tournament/.test(p.table)) { clearTimeout(reload.timer); reload.timer = setTimeout(reload, 500); }
}).subscribe();

window.DUGOUT_BRACKET = bracketView;

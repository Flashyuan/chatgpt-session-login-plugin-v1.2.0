import {
  parseSessionInput,
  SUPPORTED_SESSION_COOKIE_NAMES
} from "./token.mjs";
import {
  buildSessionCookieEntries,
  belongsToSessionCookieFamily
} from "./session-cookie.mjs";

const CHATGPT_URL = "https://chatgpt.com/";

const loginForm = document.querySelector("#loginForm");
const tokenInput = document.querySelector("#sessionToken");
const cookieType = document.querySelector("#cookieType");
const toggleToken = document.querySelector("#toggleToken");
const loginButton = document.querySelector("#loginButton");
const statusMessage = document.querySelector("#statusMessage");
const sessionBadge = document.querySelector("#sessionBadge");

function setStatus(message, tone) {
  statusMessage.textContent = message;
  statusMessage.dataset.tone = tone;
  statusMessage.hidden = false;
}

function setBusy(isBusy) {
  loginButton.disabled = isBusy;
  loginButton.querySelector("span").textContent = isBusy
    ? "正在写入安全会话…"
    : "写入会话并打开 ChatGPT";
}

async function getChatGPTCookies() {
  return chrome.cookies.getAll({ domain: "chatgpt.com" });
}

async function refreshSessionBadge() {
  try {
    const cookies = await getChatGPTCookies();
    const hasSession = cookies.some((cookie) =>
      belongsToSessionCookieFamily(cookie.name, SUPPORTED_SESSION_COOKIE_NAMES)
    );

    sessionBadge.textContent = hasSession ? "已有会话" : "未登录";
    sessionBadge.dataset.active = String(hasSession);
  } catch {
    sessionBadge.textContent = "状态未知";
  }
}

async function removeCookie(cookie) {
  const host = cookie.domain.startsWith(".") ? cookie.domain.slice(1) : cookie.domain;
  const path = cookie.path || "/";
  const url = `https://${host}${path}`;

  await chrome.cookies.remove({
    url,
    name: cookie.name,
    storeId: cookie.storeId
  });
}

async function clearExistingSessionCookies() {
  const cookies = await getChatGPTCookies();
  const sessionCookies = cookies.filter((cookie) =>
    belongsToSessionCookieFamily(cookie.name, SUPPORTED_SESSION_COOKIE_NAMES)
  );

  await Promise.all(sessionCookies.map((cookie) => removeCookie(cookie)));
}

async function setOneSessionCookie(name, value) {
  const cookieDetails = {
    url: CHATGPT_URL,
    name,
    value,
    path: "/",
    secure: true,
    httpOnly: true,
    sameSite: "lax"
  };

  if (!name.startsWith("__Host-")) {
    cookieDetails.domain = ".chatgpt.com";
  }

  const savedCookie = await chrome.cookies.set(cookieDetails);

  if (!savedCookie || savedCookie.value !== value) {
    throw new Error(`浏览器未能保存会话 Cookie：${name}`);
  }

  return savedCookie;
}

async function writeSessionCookies(baseName, value) {
  // Important: remove both old unchunked cookies and old numbered chunks first,
  // otherwise stale .1/.2 chunks can corrupt the reconstructed session.
  await clearExistingSessionCookies();

  const entries = buildSessionCookieEntries(baseName, value);
  const written = [];

  try {
    for (const entry of entries) {
      written.push(await setOneSessionCookie(entry.name, entry.value));
    }
  } catch (error) {
    // Avoid leaving a half-written session if a later chunk fails.
    await clearExistingSessionCookies();
    throw error;
  }

  return written;
}

async function verifyWrittenSession(baseName, originalValue) {
  const cookies = await getChatGPTCookies();

  const exact = cookies.find((cookie) => cookie.name === baseName);
  if (exact) {
    if (exact.value !== originalValue) {
      throw new Error("Session Cookie 写入校验失败。");
    }
    return 1;
  }

  const prefix = `${baseName}.`;
  const chunks = cookies
    .filter((cookie) => cookie.name.startsWith(prefix))
    .map((cookie) => ({
      cookie,
      index: Number(cookie.name.slice(prefix.length))
    }))
    .filter((item) => Number.isInteger(item.index) && item.index >= 0)
    .sort((a, b) => a.index - b.index);

  if (chunks.length === 0) {
    throw new Error("未找到刚写入的 Session Cookie。" );
  }

  if (chunks.some((item, index) => item.index !== index)) {
    throw new Error("Session Cookie 分片编号不连续。" );
  }

  const reconstructed = chunks.map((item) => item.cookie.value).join("");
  if (reconstructed !== originalValue) {
    throw new Error("Session Cookie 分片写入校验失败。" );
  }

  return chunks.length;
}

toggleToken.addEventListener("click", () => {
  const isVisible = toggleToken.getAttribute("aria-pressed") === "true";
  toggleToken.setAttribute("aria-pressed", String(!isVisible));
  toggleToken.setAttribute("aria-label", isVisible ? "显示令牌" : "隐藏令牌");
  tokenInput.dataset.masked = String(isVisible);
  tokenInput.focus();
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  statusMessage.hidden = true;

  try {
    const { name, value } = parseSessionInput(tokenInput.value, cookieType.value);
    setBusy(true);

    const writtenCookies = await writeSessionCookies(name, value);
    const verifiedCount = await verifyWrittenSession(name, value);

    tokenInput.value = "";
    setStatus(
      verifiedCount > 1
        ? `新版 Session 已写入 ${verifiedCount} 个 Cookie 分片，正在打开 ChatGPT。`
        : "会话已写入，正在打开 ChatGPT。",
      "success"
    );

    console.info(
      `[ChatGPT Session] wrote ${writtenCookies.length} cookie(s):`,
      writtenCookies.map((cookie) => cookie.name)
    );

    await refreshSessionBadge();
    await chrome.tabs.create({ url: CHATGPT_URL });
    window.close();
  } catch (error) {
    const message = error instanceof Error ? error.message : "写入失败，请重试。";
    setStatus(message, "error");
    tokenInput.focus();
  } finally {
    setBusy(false);
  }
});

refreshSessionBadge();
tokenInput.dataset.masked = "true";
tokenInput.focus();

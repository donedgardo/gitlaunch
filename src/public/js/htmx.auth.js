let authToken;
function getCookie(name) {
  const value = "; " + document.cookie;
  const parts = value.split("; " + name + "=");
  if (parts.length === 2) {
    return parts.pop().split(";").shift();
  }
}
// auth is a promise returned by our authentication system
const auth = function () {
  return new Promise((resolve, reject) => {
    const authCookie = getCookie("authToken");
    return resolve(authCookie);
  });
};

// await the auth token and store it somewhere
auth().then((token) => {
  authToken = token;
});

// gate htmx requests on the auth token (only for API requests that need it)
window.htmx.on("htmx:confirm", (e) => {
  // Only gate requests that need auth tokens (API endpoints)
  // Dashboard navigation uses session cookies, not auth tokens
  const url = e.detail.path || "";
  if (url.startsWith("/api/") && authToken == null) {
    // stop the regular request from being issued
    e.preventDefault();
    // only issue it once the auth promise has resolved
    auth().then(() => e.detail.issueRequest());
  }
});

// add the auth token to the request as a header
window.htmx.on("htmx:configRequest", (e) => {
  e.detail.headers["Authorization"] = `Bearer ${authToken}`;
});

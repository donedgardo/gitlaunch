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

// gate htmx requests on the auth token
window.htmx.on("htmx:confirm", (e) => {
  // if there is no auth token
  if (authToken == null) {
    // stop the regular request from being issued
    e.preventDefault();
    // only issue it once the auth promise has resolved
    auth.then(() => e.detail.issueRequest());
  }
});

// add the auth token to the request as a header
window.htmx.on("htmx:configRequest", (e) => {
  e.detail.headers["Authorization"] = `Bearer ${authToken}`;
});

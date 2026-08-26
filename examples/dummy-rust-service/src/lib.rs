//! The bits of the service worth testing without opening a socket.

pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Pull the request target out of an HTTP request line.
///
/// Returns `None` for anything that is not a well-formed request line, which
/// the server answers with a 400.
pub fn request_target(request_line: &str) -> Option<&str> {
    let mut parts = request_line.trim_end().split(' ');
    let method = parts.next()?;
    let target = parts.next()?;
    let version = parts.next()?;

    if method != "GET" || !version.starts_with("HTTP/") || target.is_empty() {
        return None;
    }

    Some(target)
}

/// Render an HTTP/1.1 response with a plain-text body.
pub fn response(status: u16, reason: &str, body: &str) -> String {
    format!(
        "HTTP/1.1 {status} {reason}\r\n\
         content-type: text/plain; charset=utf-8\r\n\
         content-length: {len}\r\n\
         connection: close\r\n\
         \r\n\
         {body}",
        len = body.len()
    )
}

/// Route a request target to a response.
pub fn handle(target: &str) -> String {
    match target {
        "/healthz" => response(200, "OK", "ok"),
        "/version" => response(200, "OK", VERSION),
        _ => response(404, "Not Found", "not found"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_target_out_of_a_request_line() {
        assert_eq!(
            request_target("GET /healthz HTTP/1.1\r\n"),
            Some("/healthz")
        );
    }

    #[test]
    fn rejects_a_request_line_it_cannot_serve() {
        assert_eq!(request_target("POST /healthz HTTP/1.1"), None);
        assert_eq!(request_target("GET /healthz"), None);
        assert_eq!(request_target(""), None);
    }

    #[test]
    fn healthz_answers_ok() {
        let res = handle("/healthz");
        assert!(res.starts_with("HTTP/1.1 200 OK\r\n"));
        assert!(res.ends_with("\r\n\r\nok"));
    }

    #[test]
    fn version_answers_the_crate_version() {
        assert!(handle("/version").ends_with(VERSION));
    }

    #[test]
    fn anything_else_is_a_404() {
        assert!(handle("/nope").starts_with("HTTP/1.1 404 Not Found"));
    }

    #[test]
    fn the_body_length_is_declared_honestly() {
        let res = response(200, "OK", "hello");
        assert!(res.contains("content-length: 5\r\n"));
    }
}

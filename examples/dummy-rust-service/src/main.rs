use std::env;
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};

use dummy_rust_service::{handle, request_target, response, VERSION};

fn main() -> std::io::Result<()> {
    let port = env::var("PORT").unwrap_or_else(|_| "8080".to_string());
    let listener = TcpListener::bind(format!("0.0.0.0:{port}"))?;
    println!("dummy-rust-service {VERSION} listening on :{port}");

    for stream in listener.incoming() {
        match stream {
            Ok(stream) => {
                if let Err(err) = serve(stream) {
                    eprintln!("connection error: {err}");
                }
            }
            Err(err) => eprintln!("accept error: {err}"),
        }
    }

    Ok(())
}

fn serve(mut stream: TcpStream) -> std::io::Result<()> {
    let mut request_line = String::new();
    BufReader::new(stream.try_clone()?).read_line(&mut request_line)?;

    let body = match request_target(&request_line) {
        Some(target) => handle(target),
        None => response(400, "Bad Request", "bad request"),
    };

    stream.write_all(body.as_bytes())?;
    stream.flush()
}

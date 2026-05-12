#!/usr/bin/env python3
"""
Tiny TCP proxy: listens on 0.0.0.0:5532 and forwards to 127.0.0.1:5432.

Used in dev so the Argus workers container can reach the host's system
Postgres (which only binds to loopback) via host.docker.internal:5532.

Production Argus deployments should point connectors at properly-exposed
Postgres instances, not through a forwarder.
"""
import socket
import sys
import threading

LISTEN_HOST = "0.0.0.0"
LISTEN_PORT = 5532
TARGET_HOST = "127.0.0.1"
TARGET_PORT = 5432
BUF = 65536


def pump(src: socket.socket, dst: socket.socket) -> None:
    try:
        while True:
            data = src.recv(BUF)
            if not data:
                break
            dst.sendall(data)
    except (OSError, ConnectionError):
        pass
    finally:
        for s in (src, dst):
            try:
                s.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            try:
                s.close()
            except OSError:
                pass


def handle(client: socket.socket, addr: tuple) -> None:
    try:
        target = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        target.connect((TARGET_HOST, TARGET_PORT))
    except OSError as e:
        print(f"[proxy] cannot reach target {TARGET_HOST}:{TARGET_PORT}: {e}", file=sys.stderr)
        client.close()
        return
    threading.Thread(target=pump, args=(client, target), daemon=True).start()
    threading.Thread(target=pump, args=(target, client), daemon=True).start()


def main() -> None:
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind((LISTEN_HOST, LISTEN_PORT))
    server.listen(32)
    print(f"[proxy] listening on {LISTEN_HOST}:{LISTEN_PORT} → {TARGET_HOST}:{TARGET_PORT}", flush=True)
    try:
        while True:
            client, addr = server.accept()
            threading.Thread(target=handle, args=(client, addr), daemon=True).start()
    except KeyboardInterrupt:
        print("[proxy] shutting down", flush=True)
    finally:
        server.close()


if __name__ == "__main__":
    main()

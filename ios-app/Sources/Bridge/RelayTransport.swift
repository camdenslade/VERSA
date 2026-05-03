import Foundation

enum RelayEvent {
    case connected
    case message(Data)
    case disconnected
}

actor RelayTransport {

    private let url:          URL
    private let clientID:     String
    // Returns a fresh JWT each time; actor-isolated so await is needed.
    private let tokenProvider: @Sendable () async throws -> String

    private var socket:        URLSessionWebSocketTask?
    private var isConnecting:  Bool = false
    private var continuation:  AsyncStream<RelayEvent>.Continuation?
    private let session = URLSession(configuration: .default)

    // Diffs produced while disconnected — flushed on next successful connect.
    private var pendingQueue: [Data] = []

    let events: AsyncStream<RelayEvent>

    init(url: URL, clientID: String, tokenProvider: @escaping @Sendable () async throws -> String) {
        self.url           = url
        self.clientID      = clientID
        self.tokenProvider = tokenProvider

        var cont: AsyncStream<RelayEvent>.Continuation!
        events = AsyncStream { cont = $0 }
        continuation = cont
    }

    // MARK: - Public

    nonisolated func connect() {
        Task { await self._connect() }
    }

    func send(_ payload: Data) async {
        guard let socket, socket.state == .running else {
            pendingQueue.append(payload)
            return
        }
        let frame = wireFrame(payload)
        do {
            try await socket.send(.data(frame))
        } catch {
            print("[RelayTransport] send failed: \(error)")
            pendingQueue.append(payload)
        }
    }

    // MARK: - Private

    private func _connect() async {
        guard !isConnecting else { return }
        isConnecting = true
        await openSocket()
    }

    private func openSocket() async {
        let token: String
        do {
            token = try await tokenProvider()
        } catch {
            print("[RelayTransport] token fetch failed: \(error) — retrying in 5s")
            isConnecting = false
            try? await Task.sleep(nanoseconds: 5_000_000_000)
            await openSocket()
            return
        }

        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "token", value: token)]

        if components.host == "localhost" {
            components.host = "127.0.0.1"
        }

        let task = session.webSocketTask(with: components.url!)
        socket = task
        task.resume()
        continuation?.yield(.connected)
        print("[RelayTransport] connected")

        // Flush diffs that were queued while offline.
        if !pendingQueue.isEmpty {
            let queued = pendingQueue
            pendingQueue.removeAll()
            for payload in queued {
                let frame = wireFrame(payload)
                try? await task.send(.data(frame))
            }
            print("[RelayTransport] flushed \(queued.count) queued diff(s)")
        }

        await readLoop(task)
    }

    private func readLoop(_ task: URLSessionWebSocketTask) async {
        while true {
            do {
                let msg = try await task.receive()
                switch msg {
                case .data(let data):
                    continuation?.yield(.message(data))

                case .string(let text):
                    await handleControlFrame(text, task: task)

                @unknown default:
                    break
                }
            } catch {
                print("[RelayTransport] disconnected: \(error.localizedDescription)")
                socket = nil
                continuation?.yield(.disconnected)
                isConnecting = false
                try? await Task.sleep(nanoseconds: 3_000_000_000)
                await openSocket()
                return
            }
        }
    }

    private func handleControlFrame(_ text: String, task: URLSessionWebSocketTask) async {
        guard
            let data = text.data(using: .utf8),
            let obj  = try? JSONSerialization.jsonObject(with: data) as? [String: String],
            let type = obj["type"]
        else { return }

        switch type {
        case "token_expiring_soon":
            print("[RelayTransport] token expiring — refreshing")
            do {
                let fresh = try await tokenProvider()
                let reauth = "{\"type\":\"reauth\",\"token\":\"\(fresh)\"}"
                try await task.send(.string(reauth))
                print("[RelayTransport] reauth sent")
            } catch {
                print("[RelayTransport] reauth failed: \(error)")
            }

        case "reauth_ok":
            print("[RelayTransport] reauth accepted")

        default:
            break
        }
    }

    private func wireFrame(_ payload: Data) -> Data {
        let idBytes = Data(clientID.utf8)
        var frame   = Data(capacity: 4 + idBytes.count + payload.count)
        var len     = UInt32(idBytes.count).bigEndian
        frame.append(contentsOf: withUnsafeBytes(of: &len, Array.init))
        frame.append(idBytes)
        frame.append(payload)
        return frame
    }
}

import Foundation

enum RelayEvent {
    case connected
    case message(Data)
    case disconnected
}

actor RelayTransport {

    private let url:          URL
    private let clientID:     String
    private var socket:       URLSessionWebSocketTask?
    private var isConnecting: Bool = false
    private var continuation: AsyncStream<RelayEvent>.Continuation?
    private let session = URLSession(configuration: .default)

    let events: AsyncStream<RelayEvent>

    init(url: URL, clientID: String) {
        self.url      = url
        self.clientID = clientID

        var cont: AsyncStream<RelayEvent>.Continuation!
        events = AsyncStream { cont = $0 }
        continuation = cont
        // Don't connect here — TaskEngine calls connect() after it starts listening
    }

    // MARK: - Public

    nonisolated func connect() {
        Task { await self._connect() }
    }

    private func _connect() async {
        guard !isConnecting else { return }
        isConnecting = true
        await openSocket()
    }

    func send(_ payload: Data) async {
        guard let socket else { return }
        let frame = wireFrame(payload)
        do {
            try await socket.send(.data(frame))
        } catch {
            print("[RelayTransport] send failed: \(error)")
        }
    }

    // MARK: - Private

    private func openSocket() async {
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "client_id", value: clientID)]

        // Force 127.0.0.1 — avoids the ::1 (IPv6) → 127.0.0.1 (IPv4) flip
        // that causes immediate disconnects on the iOS simulator.
        if components.host == "localhost" {
            components.host = "127.0.0.1"
        }

        let task = session.webSocketTask(with: components.url!)
        socket = task
        task.resume()
        continuation?.yield(.connected)
        print("[RelayTransport] connected to \(url)")
        await readLoop(task)
    }

    private func readLoop(_ task: URLSessionWebSocketTask) async {
        while true {
            do {
                let msg = try await task.receive()
                print("[RelayTransport] received frame")
                switch msg {
                case .data(let data):
                    continuation?.yield(.message(data))
                case .string(let s):
                    print("[RelayTransport] unexpected text frame: \(s.prefix(80))")
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

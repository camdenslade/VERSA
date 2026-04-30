import Foundation
import Observation

@Observable
@MainActor
final class TaskEngine {

    // MARK: - State
    private(set) var tasks:     [AppTask] = []
    private(set) var syncState: SyncState = .disconnected

    // MARK: - Private
    private let crdt:      VersaCoreEngine
    private let transport: RelayTransport

    init(relayURL: URL? = nil) {
        let relayURL = relayURL ?? TaskEngine.relayURL()
        let clientID = Self.stableClientID()
        crdt      = VersaCoreEngine(clientId: clientID)
        transport = RelayTransport(url: relayURL, clientID: clientID)

        // Load persisted snapshot before connecting so UI is instant on launch.
        if let saved = Self.loadSnapshot() {
            let crdtRef = crdt
            do {
                try crdtRef.mergeUpdate(bytes: saved)
                tasks = crdtRef.getTasks().map(AppTask.init)
            } catch {
                print("[VersaCore] snapshot load failed: \(error)")
            }
        }

        Task { await self.connectAndListen() }
    }

    // MARK: - Public mutations

    func addTask(content: String) {
        let task = AppTask(
            id:           UUID().uuidString,
            content:      content,
            isCompleted:  false,
            lastModified: Date().millisecondsSince1970
        )
        tasks.append(task)
        sendToRust(task)
    }

    func toggleTask(_ id: String) {
        guard let idx = tasks.firstIndex(where: { $0.id == id }) else { return }
        tasks[idx].isCompleted.toggle()
        tasks[idx].lastModified = Date().millisecondsSince1970
        sendToRust(tasks[idx])
    }

    // MARK: - Private

    private func sendToRust(_ task: AppTask) {
        let ffiTask = FfiTask(
            id:           task.id,
            content:      task.content,
            isCompleted:  task.isCompleted,
            lastModified: task.lastModified
        )
        let crdtRef   = crdt
        let transport = transport
        Task.detached(priority: .userInitiated) {
            do {
                let diff: Data = try crdtRef.applyTask(task: ffiTask)
                Self.persistSnapshot(crdtRef.snapshot())
                await transport.send(diff)
            } catch {
                print("[VersaCore] apply_task failed: \(error)")
            }
        }
    }

    private func connectAndListen() async {
        syncState = .connecting
        transport.connect()
        for await event in transport.events {
            switch event {
            case .connected:
                syncState = .connected
                // Send full snapshot so peers get all our state immediately.
                let crdtRef   = crdt
                let transport = transport
                Task.detached(priority: .userInitiated) {
                    await transport.send(crdtRef.snapshot())
                }

            case .message(let data):
                let payload = stripHeader(data)
                let crdtRef = crdt
                let result: [AppTask]? = await Task.detached(priority: .userInitiated) {
                    do {
                        try crdtRef.mergeUpdate(bytes: payload)
                        let tasks = crdtRef.getTasks().map(AppTask.init)
                        Self.persistSnapshot(crdtRef.snapshot())
                        return tasks
                    } catch {
                        print("[VersaCore] merge_update failed: \(error)")
                        return nil
                    }
                }.value
                if let result {
                    tasks = result
                }

            case .disconnected:
                syncState = .disconnected
            }
        }
    }

    // MARK: - Persistence

    private static var snapshotURL: URL {
        FileManager.default
            .urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("versa.snapshot")
    }

    private static func persistSnapshot(_ data: Data) {
        try? FileManager.default.createDirectory(
            at: snapshotURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try? data.write(to: snapshotURL, options: .atomic)
    }

    private static func loadSnapshot() -> Data? {
        try? Data(contentsOf: snapshotURL)
    }

    // MARK: - Helpers

    private func stripHeader(_ data: Data) -> Data {
        guard data.count >= 4 else { return data }
        let idLen = Int(UInt32(bigEndian: data.withUnsafeBytes { $0.load(as: UInt32.self) }))
        let offset = 4 + idLen
        guard offset <= data.count else { return data }
        return data.subdata(in: offset..<data.count)
    }

    static func relayURL() -> URL {
        let info   = Bundle.main.infoDictionary!
        let host   = info["RELAY_HOST"] as? String ?? "127.0.0.1"
        let port   = info["RELAY_PORT"] as? String ?? "8080"
        let scheme = (port == "443") ? "wss" : "ws"
        return URL(string: "\(scheme)://\(host):\(port)/sync")!
    }

    static func stableClientID() -> String {
        let key = "versa.client_id"
        if let existing = UserDefaults.standard.string(forKey: key) { return existing }
        let new = UUID().uuidString
        UserDefaults.standard.set(new, forKey: key)
        return new
    }
}

// MARK: - SyncState
enum SyncState { case disconnected, connecting, connected }

// MARK: - App model
struct AppTask: Identifiable {
    var id:           String
    var content:      String
    var isCompleted:  Bool
    var lastModified: Int64

    init(_ ffi: FfiTask) {
        id           = ffi.id
        content      = ffi.content
        isCompleted  = ffi.isCompleted
        lastModified = ffi.lastModified
    }

    init(id: String, content: String, isCompleted: Bool, lastModified: Int64) {
        self.id           = id
        self.content      = content
        self.isCompleted  = isCompleted
        self.lastModified = lastModified
    }
}

extension Date {
    var millisecondsSince1970: Int64 {
        Int64((timeIntervalSince1970 * 1000).rounded())
    }
}

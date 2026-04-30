import Foundation
import Security

private struct LoginRequest: Encodable {
    let email:    String
    let password: String
}

private struct AuthTokens: Decodable {
    let accessToken:  String
    let refreshToken: String?
}

private struct AuthResponse: Decodable {
    let tokens: AuthTokens?
    // Fallback: some endpoints return tokens at top level (e.g. refresh)
    let accessToken:  String?
    let refreshToken: String?

    var resolvedTokens: AuthTokens? {
        if let t = tokens { return t }
        if let at = accessToken { return AuthTokens(accessToken: at, refreshToken: refreshToken) }
        return nil
    }
}

enum KimbuAuthError: Error {
    case notAuthenticated
    case httpError(Int)
    case noToken
    case refreshFailed
}

actor KimbuAuth {

    static let shared = KimbuAuth()

    private let baseURL = URL(string: "https://api.kimbu.cslade.space/v1/auth")!
    private let appID   = "versa"
    private let session = URLSession(configuration: .ephemeral)
    private let keychainService = "space.cslade.versa"

    private var cachedToken: String?

    // MARK: - Public

    func isAuthenticated() -> Bool {
        loadFromKeychain(key: "refresh_token") != nil
    }

    func login(email: String, password: String) async throws {
        let body = try JSONEncoder().encode(LoginRequest(email: email, password: password))
        let data = try await post(path: "login", body: body)
        let resp = try JSONDecoder().decode(AuthResponse.self, from: data)
        guard let t = resp.resolvedTokens, !t.accessToken.isEmpty else { throw KimbuAuthError.noToken }
        cachedToken = t.accessToken
        save(key: "access_token",  value: t.accessToken)
        if let rt = t.refreshToken { save(key: "refresh_token", value: rt) }
    }

    func register(email: String, password: String) async throws {
        let body = try JSONEncoder().encode(LoginRequest(email: email, password: password))
        let data = try await post(path: "register", body: body)
        let resp = try JSONDecoder().decode(AuthResponse.self, from: data)
        guard let t = resp.resolvedTokens, !t.accessToken.isEmpty else { throw KimbuAuthError.noToken }
        cachedToken = t.accessToken
        save(key: "access_token",  value: t.accessToken)
        if let rt = t.refreshToken { save(key: "refresh_token", value: rt) }
    }

    /// Returns a valid access token, refreshing silently if needed.
    func token() async throws -> String {
        if let t = cachedToken { return t }
        // Try stored refresh token first.
        if let rt = loadFromKeychain(key: "refresh_token") {
            return try await refreshWith(rt)
        }
        throw KimbuAuthError.notAuthenticated
    }

    /// Called on token_expiring_soon — returns a fresh token.
    func refresh() async throws -> String {
        guard let rt = loadFromKeychain(key: "refresh_token") else {
            throw KimbuAuthError.notAuthenticated
        }
        return try await refreshWith(rt)
    }

    /// Clears all tokens (logout or 401).
    func invalidate() {
        cachedToken = nil
        delete(key: "access_token")
        // Keep refresh token — let the next token() call try it once more.
        // Only wipe it if refresh itself fails (handled in refreshWith).
    }

    func logout() {
        cachedToken = nil
        delete(key: "access_token")
        delete(key: "refresh_token")
    }

    // MARK: - Private

    private func refreshWith(_ rt: String) async throws -> String {
        do {
            let body = try JSONEncoder().encode(["refreshToken": rt])
            let data = try await post(path: "refresh", body: body)
            let resp = try JSONDecoder().decode(AuthResponse.self, from: data)
            guard let t = resp.resolvedTokens, !t.accessToken.isEmpty else { throw KimbuAuthError.noToken }
            cachedToken = t.accessToken
            save(key: "access_token", value: t.accessToken)
            if let newRt = t.refreshToken { save(key: "refresh_token", value: newRt) }
            return t.accessToken
        } catch KimbuAuthError.httpError {
            delete(key: "refresh_token") // refresh token is dead
            throw KimbuAuthError.notAuthenticated
        }
    }

    private func post(path: String, body: Data) async throws -> Data {
        var req = URLRequest(url: baseURL.appendingPathComponent(path))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(appID, forHTTPHeaderField: "X-App-Id")
        req.httpBody = body
        let (data, response) = try await session.data(for: req)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200...299).contains(status) else { throw KimbuAuthError.httpError(status) }
        return data
    }

    // MARK: - Keychain

    private func save(key: String, value: String) {
        let query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: keychainService,
            kSecAttrAccount: key,
        ]
        SecItemDelete(query as CFDictionary)
        var add = query; add[kSecValueData] = Data(value.utf8)
        SecItemAdd(add as CFDictionary, nil)
    }

    private func loadFromKeychain(key: String) -> String? {
        let query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: keychainService,
            kSecAttrAccount: key,
            kSecReturnData: true,
            kSecMatchLimit: kSecMatchLimitOne,
        ]
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private func delete(key: String) {
        let query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: keychainService,
            kSecAttrAccount: key,
        ]
        SecItemDelete(query as CFDictionary)
    }
}

import SwiftUI

struct LoginView: View {
    let onLogin: () async -> Void

    @State private var mode:         Mode = .login
    @State private var email         = ""
    @State private var password      = ""
    @State private var showPassword  = false
    @State private var loading       = false
    @State private var error:        String?

    enum Mode { case login, register }

    var body: some View {
        VStack(spacing: 24) {
            Spacer()

            Text("Versa")
                .font(.largeTitle.bold())

            Text(mode == .login ? "Sign in to continue" : "Create your account")
                .foregroundStyle(.secondary)
                .font(.subheadline)

            VStack(spacing: 12) {
                TextField("Email", text: $email)
                    .textContentType(.emailAddress)
                    .keyboardType(.emailAddress)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                    .padding()
                    .background(.quaternary, in: RoundedRectangle(cornerRadius: 10))

                HStack {
                    Group {
                        if showPassword {
                            TextField("Password", text: $password)
                                .textContentType(mode == .login ? .password : .newPassword)
                        } else {
                            SecureField(mode == .register ? "Password (8+ chars, A-Z, 0-9, symbol)" : "Password", text: $password)
                                .textContentType(mode == .login ? .password : .newPassword)
                        }
                    }
                    Button { showPassword.toggle() } label: {
                        Text(showPassword ? "Hide" : "Show")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                .padding()
                .background(.quaternary, in: RoundedRectangle(cornerRadius: 10))
            }
            .padding(.horizontal)

            if let error {
                Text(error)
                    .foregroundStyle(.red)
                    .font(.footnote)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)
            }

            Button {
                Task { await submit() }
            } label: {
                Group {
                    if loading {
                        ProgressView().tint(.white)
                    } else {
                        Text(mode == .login ? "Sign In" : "Create Account")
                    }
                }
                .frame(maxWidth: .infinity)
                .padding()
                .background(canSubmit ? Color.accentColor : .gray)
                .foregroundStyle(.white)
                .clipShape(RoundedRectangle(cornerRadius: 10))
            }
            .disabled(!canSubmit || loading)
            .padding(.horizontal)

            Button {
                withAnimation { mode = (mode == .login) ? .register : .login }
                error = nil
            } label: {
                Text(mode == .login ? "No account? Create one" : "Already have one? Sign in")
                    .font(.footnote)
                    .foregroundStyle(Color.accentColor)
            }

            Spacer()
        }
    }

    private var canSubmit: Bool { !email.isEmpty && !password.isEmpty }

    private func submit() async {
        loading = true
        error   = nil
        do {
            if mode == .login {
                try await KimbuAuth.shared.login(email: email, password: password)
            } else {
                try await KimbuAuth.shared.register(email: email, password: password)
            }
            await onLogin()
        } catch KimbuAuthError.httpError(let code) {
            error = code == 401 ? "Incorrect email or password." : "Failed (\(code)). Check your details."
        } catch {
            self.error = error.localizedDescription
        }
        loading = false
    }
}

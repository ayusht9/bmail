# Outlook and Microsoft 365

When built with Bmail's Microsoft registration, Bmail connects to Outlook.com, Hotmail, Live, and Microsoft 365 using IMAP with Microsoft OAuth2. It never asks for your Microsoft account password. Enable IMAP in your mailbox settings first; work or school administrators may need to enable IMAP and approve the application.

## App registration

Microsoft app registration is a one-time publisher task. Mailbox users do not enter a client ID. The publisher configures Bmail's own registered client ID when building the app. Without that configuration, Outlook sign-in and saving an Outlook account are disabled with an availability message.

1. In Microsoft Entra admin center, open **App registrations > New registration**.
2. Choose **Accounts in any organizational directory and personal Microsoft accounts**.
3. Under **Authentication > Advanced settings**, enable **Allow public client flows**. Device-code sign-in does not need a redirect URI or client secret.
4. Under **API permissions**, add **Office 365 Exchange Online > Delegated permissions > IMAP.AccessAsUser.All**. Grant administrator consent if your organization requires it. Bmail also requests `offline_access` to reconnect for scheduled backups.
5. Copy the **Application (client) ID** from the app overview.
6. In the PowerShell shell used to build Bmail, configure the public ID, then build:

```powershell
$env:BMAIL_MICROSOFT_CLIENT_ID = 'your-registered-application-client-id'
npm.cmd run tauri:build
```

Replace the placeholder with the real GUID. A malformed or empty value fails the native build. The ID is compiled into Bmail's native backend; it is not a secret and is never requested in the mailbox form. Do not configure a client secret. The application must belong to Bmail; do not reuse another application's registration. Creating the registration requires access to an Entra tenant with app-registration permissions. Source changes alone cannot create that Microsoft-side identity.

## Connect

1. Add an account in Bmail and select **Microsoft Outlook / Hotmail / Microsoft 365**.
2. Enter the full mailbox email address. The server is `outlook.office365.com`, TLS port `993`.
3. Choose **Sign in with Microsoft**. If sign-in is unavailable, the publisher has not configured this build; a mailbox password cannot resolve that.
4. Bmail opens Microsoft's device sign-in page in your default browser. Enter the code displayed in Bmail and sign in as the mailbox address you entered.
5. Select **Save mailbox**. Bmail waits for Microsoft approval; keep the dialog open until it finishes. If the code expires or access is denied, start sign-in again.
6. Run **Sync mailbox** or start a backup to verify mailbox access. Saving credentials does not test the IMAP connection.

Refresh tokens are encrypted with Windows DPAPI for the current Windows user, inside the existing protected credential directory. Each backup, mailbox check, and folder listing obtains a new access token and saves a rotated refresh token when Microsoft supplies one. Access tokens travel to the backup engine over stdin, never process arguments. Existing password-based providers continue using their app passwords.

If Microsoft revokes access, use mailbox setup to sign in again. Organization policies can block device-code sign-in or require administrator approval. Sovereign Microsoft cloud endpoints and on-premises Exchange are not covered by this preset.

Protocol references: [Microsoft IMAP OAuth](https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth), [device-code sign-in](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-device-code), [Outlook IMAP settings](https://support.microsoft.com/en-gb/outlook/pop-imap-and-smtp-settings-for-outlook-com).

## Wrong server saved under Other IMAP server

An email domain such as `outlook.in` is not the IMAP server. Use `outlook.office365.com`, TLS port `993`, with Microsoft sign-in. Choosing Other IMAP server does not enable app-password access to Outlook.

Bmail recognizes common Outlook, Hotmail, and Live email domains entered in the server field. For an existing profile that saved one of these domains and has no backup manifest, Account settings shows the correct server and Microsoft sign-in. Complete sign-in and save to repair the profile while keeping the email address, backup directory, and preferences. Profiles with an existing backup manifest retain their original server identity.

The publisher supplies the client ID through the app registration described above. Users never enter it. A build without a registered ID cannot connect Outlook accounts; there is no app-password fallback.

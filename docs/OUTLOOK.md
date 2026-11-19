# Outlook and Microsoft 365

Bmail connects to Outlook.com, Hotmail, Live, and Microsoft 365 using IMAP with Microsoft OAuth2. It never asks for your Microsoft account password. Enable IMAP in your mailbox settings first; work or school administrators may need to enable IMAP and approve the application.

## App registration

This version requires your own Microsoft application (client) ID. Bmail does not ship a shared Microsoft app registration.

1. In Microsoft Entra admin center, open **App registrations > New registration**.
2. Choose **Accounts in any organizational directory and personal Microsoft accounts**.
3. Under **Authentication > Advanced settings**, enable **Allow public client flows**. Device-code sign-in does not need a redirect URI or client secret.
4. Under **API permissions**, add **Office 365 Exchange Online > Delegated permissions > IMAP.AccessAsUser.All**. Grant administrator consent if your organization requires it. Bmail also requests `offline_access` to reconnect for scheduled backups.
5. Copy the **Application (client) ID** from the app overview.

## Connect

1. Add an account in Bmail and select **Microsoft Outlook / Hotmail / Microsoft 365**.
2. Enter the full mailbox email address. The server is `outlook.office365.com`, TLS port `993`.
3. Paste the client ID and choose **Start Microsoft sign-in**.
4. Visit the Microsoft address displayed in the dialog, enter the displayed code, and sign in as the mailbox address you entered.
5. Select **Save mailbox**. Bmail waits for Microsoft approval; keep the dialog open until it finishes. If the code expires or access is denied, start sign-in again.
6. Run **Sync mailbox** or start a backup to verify mailbox access. Saving credentials does not test the IMAP connection.

Refresh tokens are encrypted with Windows DPAPI for the current Windows user, inside the existing protected credential directory. Each backup, mailbox check, and folder listing obtains a new access token and saves a rotated refresh token when Microsoft supplies one. Access tokens travel to the backup engine over stdin, never process arguments. Existing password-based providers continue using their app passwords.

If Microsoft revokes access, use mailbox setup to sign in again with the client ID. Organization policies can block device-code sign-in or require administrator approval. Sovereign Microsoft cloud endpoints and on-premises Exchange are not covered by this preset.

Protocol references: [Microsoft IMAP OAuth](https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth), [device-code sign-in](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-device-code), [Outlook IMAP settings](https://support.microsoft.com/en-gb/outlook/pop-imap-and-smtp-settings-for-outlook-com).

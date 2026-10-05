namespace SafeExam.Client.Config;

/// *.safeexam file ka outer envelope (payload base64url JSON, signature base64url ECDSA P-256).
public sealed record SignedConfigFile(string KeyId, string Payload, string Signature);

/// Signed payload (Section 2.3). Sab fields camelCase JSON se map hote hain.
public sealed record ExamConfig
{
    public int? Version { get; init; }
    public DateTimeOffset? IssuedAt { get; init; }
    public DateTimeOffset? ExpiresAt { get; init; }
    public string? ExamUrl { get; init; }
    public IReadOnlyList<string> AllowedHosts { get; init; } = Array.Empty<string>();
    public string? ApiBaseUrl { get; init; }
    public bool ExitRequiresCode { get; init; }
    public string? ExitCodeSalt { get; init; }
    public string? ExitCodeSha256 { get; init; }
    public IReadOnlyList<string> ProhibitedProcesses { get; init; } = Array.Empty<string>();
    public IReadOnlyList<string> AccessibilityAllowedProcesses { get; init; } = Array.Empty<string>();
    public bool AllowExternalDisplay { get; init; }
    public bool CameraAllowed { get; init; }
    public bool MicrophoneAllowed { get; init; }
    public string? MinClientVersion { get; init; }

    // ---- Extras (spec ke upar, sab optional) ----
    /// C-10: clipboard change ke baad clear (default true)
    public bool ClearClipboardOnChange { get; init; } = true;
    /// C-23: accommodation set hai => native events accessibilityMode:true ke saath jaate hain
    public bool AccessibilityMode { get; init; }
    /// C-19: signed update metadata URL + allowed update hosts
    public string? UpdateMetadataUrl { get; init; }
    public IReadOnlyList<string> UpdateHosts { get; init; } = Array.Empty<string>();

    /// JSON null aane par lists null na rahein.
    public ExamConfig Normalized() => this with
    {
        AllowedHosts = AllowedHosts ?? Array.Empty<string>(),
        ProhibitedProcesses = ProhibitedProcesses ?? Array.Empty<string>(),
        AccessibilityAllowedProcesses = AccessibilityAllowedProcesses ?? Array.Empty<string>(),
        UpdateHosts = UpdateHosts ?? Array.Empty<string>(),
    };
}

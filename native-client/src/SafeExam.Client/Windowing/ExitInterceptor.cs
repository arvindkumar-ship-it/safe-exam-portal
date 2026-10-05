using SafeExam.Client.Exam;

namespace SafeExam.Client.Windowing;

public interface IExitPrompt
{
    /// Dialog dikhao. codeRequired=false => sirf confirm (khali string = OK, null = cancel).
    string? AskCode(bool codeRequired);
}

/// C-06: window close (Alt+F4, X) cancel => exit-code dialog; sahi code par hi close.
public sealed class ExitInterceptor
{
    private IWindow? _window;
    private ExitPolicy? _policy;
    private IExitPrompt? _prompt;
    private KioskWindowManager? _kiosk;
    private bool _authorized, _prompting;

    public bool IsAuthorized => _authorized;

    public void Attach(IWindow window, ExitPolicy policy, IExitPrompt prompt, KioskWindowManager? kiosk = null)
    {
        _window = window; _policy = policy; _prompt = prompt; _kiosk = kiosk;
        window.Closing += (s, e) =>
        {
            if (_authorized) return;
            e.Cancel = true;
            window.Post(PromptUser);
        };
    }

    private void PromptUser()
    {
        if (_prompting || _window == null || _policy == null || _prompt == null) return;
        _prompting = true;
        try
        {
            using (_kiosk?.SuspendFocusTracking())
            {
                var code = _prompt.AskCode(_policy.RequiresCode);
                if (_policy.Verify(code)) { _authorized = true; _window.Close(); }
            }
        }
        finally { _prompting = false; }
    }

    /// Exam khatam (terminal status) => ab bina code ke band ho sakta hai.
    public void AuthorizeExit() => _authorized = true;

    /// Bridge `requestExit`: web ne code bheja.
    public bool TryRequestClose(string? code)
    {
        if (_policy == null || !_policy.Verify(code)) return false;
        _authorized = true;
        _window?.Post(() => _window.Close());
        return true;
    }
}

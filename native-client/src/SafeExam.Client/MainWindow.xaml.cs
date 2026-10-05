using System.Windows;
using Microsoft.Web.WebView2.Wpf;

namespace SafeExam.Client;

public partial class MainWindow : Window
{
    public event EventHandler? SystemCheckRequested;

    public MainWindow() { InitializeComponent(); }

    public WebView2 BrowserControl => Browser;

    /// Error/status: browser chhupao, message dikhao (airspace).
    public void ShowStatus(string message, bool systemCheck = false)
    {
        Browser.Visibility = Visibility.Collapsed;
        StatusText.Text = message;
        SystemCheckButton.Visibility = systemCheck ? Visibility.Visible : Visibility.Collapsed;
        StatusPanel.Visibility = Visibility.Visible;
    }

    public void HideStatus()
    {
        StatusPanel.Visibility = Visibility.Collapsed;
        Browser.Visibility = Visibility.Visible;
    }

    private void OnSystemCheck(object sender, RoutedEventArgs e) => SystemCheckRequested?.Invoke(this, EventArgs.Empty);
}

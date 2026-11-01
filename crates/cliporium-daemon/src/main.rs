#[tokio::main]
async fn main() -> anyhow::Result<()> {
    cliporium_daemon::run().await
}

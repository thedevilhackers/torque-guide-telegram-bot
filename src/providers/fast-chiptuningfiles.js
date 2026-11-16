// fast-chiptuningfiles.com, the file service Unity Performance sends files to.
//
// Their reseller API isn't publicly documented, so orders aren't sent automatically yet. Until then
// the admin panel walks through sending each file by hand: download the original from the order,
// upload it on fast-chiptuningfiles.com, note their order number on our order (which marks it "In
// progress"), then upload the tuned file they return, which makes it ready for the customer.
//
// To connect the API: put FCF_API_URL and FCF_API_KEY in the server's environment file (never in the
// code or a chat), and write send() and fetchResult() here from their documentation.

export const FCF_SITE = "https://fast-chiptuningfiles.com";

export function fcfStatus() {
  const configured = Boolean(process.env.FCF_API_URL && process.env.FCF_API_KEY);
  return {
    name: "fast-chiptuningfiles.com",
    site: FCF_SITE,
    connected: false,
    configured,
    note: configured
      ? "API details are on the server, but sending isn't written yet: it needs fast-chiptuningfiles.com's API documentation."
      : "Send files by hand on fast-chiptuningfiles.com. Automatic sending needs their API documentation and key."
  };
}

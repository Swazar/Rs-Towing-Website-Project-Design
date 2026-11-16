# RS on the Go LLC website

The site is plain HTML, CSS, and JavaScript. Netlify serves the `public` folder and handles the quote and review forms. There are no packages to install or build commands to run.

## Preview locally

From the Git repository root, run:

```powershell
python -m http.server 8000 --bind 127.0.0.1 --directory public
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000) in a browser. This serves the pages, U.S. city suggestions, and the fallback map. To test driving routes locally, use `npx netlify-cli dev` from the repository root and open the URL it prints. Netlify Dev reads `GEOAPIFY_ROUTING_KEY` from a local `.env` file or a linked project. Test form delivery on a Netlify deploy. [Netlify Dev functions](https://docs.netlify.com/api-and-cli-guides/cli-guides/manage-functions/#invoke-functions-while-running-netlify-dev).

## Deploy from GitHub

1. Push the branch containing the redesign to GitHub. In Netlify, import the existing RS Towing repository from GitHub and select that branch.
2. Leave the base directory and build command blank. The publish directory is `public`, as configured in `netlify.toml`.
3. In the Netlify project’s **Forms** tab, enable form detection and redeploy. Check that Netlify lists two forms, `quote-request` and `customer-review`. [Form setup](https://docs.netlify.com/manage/forms/setup/).
4. Under **Forms → Submission notifications**, add an email notification for each form and enter the inbox where leads and feedback should arrive. Netlify accepts an active team member’s address or, where available, an outside address that completes email confirmation. The notification recipient can be changed from this screen. [Form notifications](https://docs.netlify.com/manage/forms/notifications/).
5. Submit a test quote and a test review on the Netlify URL. Verify that each opens its confirmation page, appears in the Forms dashboard, and reaches the intended inbox. Check that `/reviews.html` redirects to `/reviews/`.
6. Once the site and forms pass those checks, add `rsonthegollc.com` under **Domain management** if you want to keep the existing domain. Follow the DNS instructions Netlify shows for the project. If the domain also handles business email, preserve its existing mail-related DNS records during the website move. [Custom domains](https://docs.netlify.com/manage/domains/get-started-with-domains/).

## Email and reviews

Netlify handles website submissions and can send notifications to the inbox you choose. The public **Email us** link in `public/index.html` still points to the business address from the previous site. Update that link if the public contact address changes.

Incoming reviews live in Netlify Forms. To publish one, confirm that the customer checked the publishing permission box, then add an object to `public/assets/reviews.json` with their public first name as `name`, review as `quote`, a whole-number `rating` from 1 to 5, and the review `date` in `YYYY-MM-DD` format. Keep email addresses and other contact details out of the public file. Redeploy to show the three most recent approved reviews. If a review has no date, it follows the dated entries. If the old website received reviews or quotes, export them from the previous database or form provider before retiring those services. The Git repository contains the old review schema and site code, but no database export.

## Route preview

City suggestions use a bundled 2026 U.S. Census Places Gazetteer for the 50 states and D.C. When the customer types a street number followed by a street name, Netlify sends the partial address to Geoapify for U.S. address suggestions. **Use my location** fills the pickup coordinates after the customer grants permission and the browser checks them against the Census national boundary. [Census Gazetteer](https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html) · [Census boundary files](https://www2.census.gov/geo/tiger/GENZ2025/kml/) · [Geoapify autocomplete](https://apidocs.geoapify.com/docs/geocoding/address-autocomplete/).

Create a free Geoapify project, set its API key in Netlify as `GEOAPIFY_ROUTING_KEY` with **Functions** access in production, and redeploy. The function sends the selected coordinates to Geoapify when a customer selects **Preview route**. The quote form draws the road route in blue and shows estimated driving miles and time between the selected points. [Geoapify pricing and limits](https://www.geoapify.com/pricing/).

If routing is unavailable, the inline map shows the selected locations and **Open in Google Maps** gives customers driving directions. The quote sends the selected addresses or cities, or the pickup coordinates from **Use my location**. [OpenStreetMap tile usage policy](https://operations.osmfoundation.org/policies/tiles/).

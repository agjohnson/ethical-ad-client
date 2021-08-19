/* Ethical ad publisher JavaScript client
 *
 * Loads placement from Ethical Ad decision API. Searches for elements with
 * `ethical-ad` data binding attributes and uses these attributes to query the
 * decision API.
 *
 * This is native JavaScript, no JQuery. It uses the API JSONP interface to get
 * around CORS and related issues. A script is added with a callback on
 * `window`. The promise is rejected if there are errors with the request or the
 * response doesn't look correct.
 *
 * Currently, only two parameters are supported with the ad placement: publisher
 * id and the place type. All of this is determined by the server and this
 * client so far only renders the API return HTML.
 *
 * This can be loaded async. CSS styles are preloaded via webpack `style-loader`.
 * There is some potential for problems if CSP rules disallow inline
 * stylesheets, but webpack does allow for a hardcoded nonce.
 *
 * Usage:
 *
 *     <script async src="ethicalads.min.js"></script>
 *     <div data-ea-publisher="foo" data-ea-type="text"></div>
 */

import verge from "verge";

import "./styles.scss";


const AD_CLIENT_VERSION = "1.2.0";  // Sent with the ad request


// For local testing, set this
// const AD_DECISION_URL = "http://ethicaladserver:5000/api/v1/decision/";
const AD_DECISION_URL = "https://server.ethicalads.io/api/v1/decision/";
const AD_TYPES_VERSION = 1;  // Used with the ad type slugs
const ATTR_PREFIX = "data-ea-";
const ABP_DETECTION_PX = "https://media.ethicalads.io/abp/px.gif";

// Keywords and topics
//
// This allows us to categorize pages simply and have better content targeting.
// Additional categorization can be done on the server side for pages
// that request ads commonly but this quick and easy categorization
// works decently well most of the time.
const KEYWORDS = {
  // Topics
  "android": "android",
  "ios": "ios",
  "iphone": "ios",
  "blockchain": "blockchain",
  "bitcoin": "bitcoin",
  "ethereum": "ethereum",
  "hyperledger": "hyperledger",
  "solidity": "solidity",
  "cryptography": "cryptography",
  "security": "security",
  "infosec": "security",
  "privacy": "privacy",
  "authentication": "authentication",
  "authorization": "authorization",
  "otp": "otp",
  "2fa": "2fa",
  "mfa": "mfa",
  "sms": "sms",
  "frontend": "frontend",
  "backend": "backend",
  "full-stack": "backend",
  "devops": "devops",
  "ai": "artificial-intelligence",
  "nlp": "nlp",
  "ml": "machine-learning",
  "cloud": "cloud",
  "api": "api",
  "docker": "docker",
  "kubernetes": "kubernetes",
  "container": "containers",
  "containers": "containers",
  "ansible": "ansible",
  "serverless": "serverless",
  "openshift": "openshift",
  "terraform": "terraform",
  "openid": "openid",
  "aws": "aws",
  "azure": "azure",
  "gcp": "gcp",
  "linux": "linux",
  "ubuntu": "ubuntu",
  "monitoring": "monitoring",
  "redis": "redis",
  "rabbitmq": "rabbitmq",
  "nosql": "nosql",
  "postgres": "postgresql",
  "postgresql": "postgresql",
  "mysql": "mysql",
  "database": "database",
  "testing": "testing",
  "pytest": "pytest",
  "lint": "lint",
  "linting": "lint",
  "pylint": "pylint",
  "unittest": "unittest",
  "ci": "ci",
  "cd": "cd",
  "tdd": "test-driven-development",
  "elasticsearch": "elasticsearch",
  "lucene": "lucene",
  "solr": "solr",
  "nginx": "nginx",
  "heroku": "heroku",
  "spa": "spa",

  // Frameworks amd modules
  "django": "django",
  "rails": "rails",
  "angular": "angular",
  "angularjs": "angular",
  "laravel": "laravel",
  "react": "reactjs",
  "reactjs": "reactjs",
  "react-native": "reactjs",
  "jupyter": "jupyter",
  "matplotlib": "matplotlib",
  "pytorch": "pytorch",
  "pydata": "pydata",
  "pandas": "pandas",
  "numpy": "numpy",
  "wsgi": "wsgi",
  "celery": "celery",
  "jinja": "jinja",
  "jinja2": "jinja",
  "flask": "flask",
  "werkzeug": "werkzeug",
  "oauth": "oauth",
  "vuejs": "vuejs",
  "vue": "vuejs",
  "tensorflow": "tensorflow",
  "tensor": "tensor",
  "webpack": "webpack",

  // Programming & markup languages
  "dotnet": "dotnet",
  ".net": "dotnet",
  "c#": "c-sharp",
  "c++": "cplusplus",
  "erlang": "erlang",
  "f#": "fsharp",
  "golang": "golang",
  "haskell": "haskell",
  "java": "java",
  "javascript": "javascript",
  "julia": "julia",
  "kotlin": "kotlin",
  "obj-c": "obj-c",
  "objective-c": "obj-c",
  "php": "php",
  "python": "python",
  "perl": "perl",
  "sql": "sql",
  "ruby": "ruby",
  "rust": "rust",
  "scala": "scala",
  "swift": "swift",
  "css": "css",
  "scss": "scss",
  "typescript": "typescript",
  "rust": "rust",
  "redux": "redux",

  // Phrases (not currently implemented)
  //"data science": "datascience",
  //"machine learning": "machine-learning",
};

// Maximum number of words of a document to analyze looking for keywords
// This is simply a check against taking too much time on very long documents
const MAX_WORDS_ANALYZED = 9999;

// Max number of detected keywords to send
// Lowering this number means that only major topics of the page get sent on long pages
const MAX_KEYWORDS = 3;

// Minimum number of occurrences of a keyword to consider it
const MIN_KEYWORD_OCCURRENCES = 2;

// Time between checking whether the ad is in the viewport to count the time viewed
// Time viewed is an important advertiser metric
const VIEW_TIME_INTERVAL = 1;  // seconds
const VIEW_TIME_MAX = 5 * 60;  // seconds

// In-viewport fudge factor
// A fudge factor of ~3 is needed for the case where the ad
// is hidden off the side of the screen by a sliding sidebar
// For example, if the right side of the ad is at x=0
// or the left side of the ad is at the right side of the viewport
const VIEWPORT_FUDGE_FACTOR = -3;  // px


/* Placement object to query decision API and return an Element node
 *
 * @param {string} publisher - Publisher ID
 * @param {string} ad_type - Placement ad type id
 * @param {Element} target - Target element
 * @param {Array[string]} keywords - An optional array of keywords
 * @param {Array[string]} campaign_types - An optional array of campaign types
 * @param {boolean} load_manually - whether this placement will be loaded manually later
 * @param {string} force_ad - force the client to show a specific ad
 * @param {string} force_campaign - force the client to show an ad from a specific campaign
 */
export class Placement {
  constructor(publisher, ad_type = "image", target, keywords, campaign_types, load_manually, force_ad, force_campaign) {
    this.publisher = publisher;
    this.ad_type = ad_type;
    this.target = target;

    this.view_time = 0;  // seconds

    this.response = null;

    this.keywords = keywords || [];
    this.campaign_types = campaign_types || [];
    if (!this.campaign_types.length) {
      this.campaign_types = ["paid", "community", "house"];
    }

    this.load_manually = load_manually;
    this.view_time_sent = false;  // true once the view time is sent to the server

    this.force_ad = force_ad;
    this.force_campaign = force_campaign;
  }

  /* Create a placement from an element
   *
   * Returns null if the placement is already loaded.
   *
   * @static
   * @param {Element} element - Load placement and append to this Element
   * @returns {Placement}
   */
  static from_element(element) {
    // Get attributes from DOM node
    const publisher = element.getAttribute(ATTR_PREFIX + "publisher");
    let ad_type = element.getAttribute(ATTR_PREFIX + "type");
    if (!ad_type) {
      ad_type = "image";
      element.setAttribute(ATTR_PREFIX + "type", "image");
    }

    const keywords = (element.getAttribute(ATTR_PREFIX + "keywords") || "").split("|").filter(word => word.length > 1);
    const campaign_types = (element.getAttribute(ATTR_PREFIX + "campaign-types") || "").split("|").filter(word => word.length > 1);

    const load_manually = element.getAttribute(ATTR_PREFIX + "manual") === "true";
    const force_ad = element.getAttribute(ATTR_PREFIX + "force-ad");
    const force_campaign = element.getAttribute(ATTR_PREFIX + "force-campaign");

    // Add version to ad type to verison the HTML return
    if (ad_type === "image" || ad_type === "text") {
      ad_type += "-v" + AD_TYPES_VERSION;
    }

    let classes = (element.className || "").split(" ");
    if (classes.indexOf("loaded") >= 0) {
      console.error("EthicalAd already loaded.");
      return null;
    }

    return new Placement(publisher, ad_type, element, keywords, campaign_types, load_manually, force_ad, force_campaign);
  }

  /* Transforms target element into a placement
   *
   * This method organizes all of the operations to transform the placement
   * configuration wrapper `div` into an ad placement -- including starting the
   * API transaction, displaying the ad element,
   * and handling the viewport detection.
   *
   * @returns {Promise}
   */
  load() {
    // Detect the keywords
    this.keywords = this.keywords.concat(this.detectKeywords());

    return this.fetch().then((element) => {
      if (element === undefined) {
        throw new EthicalAdsWarning("Ad decision request blocked");
      }

      // Add `loaded` class, signifying that the CSS styles should finally be
      // applied to the target element.
      let classes = this.target.className || "";
      classes += " loaded";
      this.target.className = classes.trim();

      // Make this element the only child element of the target element
      while (this.target.firstChild) {
        this.target.removeChild(this.target.firstChild);
      }
      this.target.appendChild(element);

      return this;
    }).then((placement) => {
      // Detect when the ad is in the viewport
      // Add the view pixel to the DOM to count the view
      // Also count the time the ad is in view
      //  this will be sent before the page/tab is closed or navigated away

      let viewport_detection = setInterval((element) => {
        if (placement.inViewport(element)) {
          // This ad was seen!
          let pixel = document.createElement("img");
          pixel.src = placement.response.view_url;
          if (uplifted) {
            pixel.src += "?uplift=true";
          }
          pixel.className = "ea-pixel";
          element.appendChild(pixel);

          clearInterval(viewport_detection);
        }
      }, 100, placement.target);

      let view_time_counter = setInterval((element) => {
        if (placement.view_time_sent) {
          clearInterval(view_time_counter);
        } else if (placement.inViewport(element)) {
          // Increment the ad's time in view counter
          placement.view_time += VIEW_TIME_INTERVAL;

          if (placement.view_time >= VIEW_TIME_MAX) {
            clearInterval(view_time_counter);
          }
        }
      }, VIEW_TIME_INTERVAL * 1000, placement.target);

      let visibility_change_listener = () => {
        if (placement.view_time <= 0 || placement.view_time_sent || !placement.response.view_time_url) return;
        // Check if the tab loses focus/is closed or the browser/app is minimized/closed
        // In that case, no longer count further time that the ad is in view
        // Send the time the ad was viewed to the server
        if (document.visibilityState === "hidden" || document.visibilityState === "unloaded") {
          let pixel = document.createElement("img");
          pixel.src = placement.response.view_time_url + "?view_time=" + placement.view_time;
          pixel.className = "ea-pixel";
          placement.target.appendChild(pixel);

          placement.view_time_sent = true;
          document.removeEventListener("visibilitychange", visibility_change_listener);
        }
      };
      document.addEventListener("visibilitychange", visibility_change_listener);
    });
  }

  /* Returns whether the ad is visible in the viewport
   *
   * @param {Element} element - The ad element
   * @returns {boolean} True if the ad is loaded and visible in the viewport
   *  (including the tab being focused and not minimized) and returns false otherwise.
   */
  inViewport(element) {
    if (this.response && this.response.view_url && verge.inViewport(element, VIEWPORT_FUDGE_FACTOR) && document.visibilityState === "visible") {
      return true;
    }

    return false;
  }

  /* Get placement data from decision API
   *
   * @returns {Promise<Element>} Resolves with an Element converted from an HTML
   * string from API response. Can also be null, indicating a noop action.
   */
  fetch() {
    const callback = "ad_" + Date.now() + "_" + Math.floor(Math.random() * 1000000);
    var div_id = callback;
    if (this.target.id) {
      div_id = this.target.id;
    }

    // There's no hard maximum on URL lengths (all of these get added to the query params)
    // but ideally we want to keep our URLs below ~2k which should work basically everywhere
    let params = {
      publisher: this.publisher,
      ad_types: this.ad_type,
      div_ids: div_id,
      callback: callback,
      keywords: this.keywords.join("|"),
      campaign_types: this.campaign_types.join("|"),
      format: "jsonp",
      client_version: AD_CLIENT_VERSION,
      // location.href includes query params (possibly sensitive) and fragments (unnecessary)
      url: (window.location.origin + window.location.pathname).slice(0, 256),
    };
    if (this.force_ad) {
      params["force_ad"] = this.force_ad;
    }
    if (this.force_campaign) {
      params["force_campaign"] = this.force_campaign;
    }
    const url_params = new URLSearchParams(params);
    const url = new URL(AD_DECISION_URL + "?" + url_params.toString());

    return new Promise((resolve, reject) => {
      window[callback] = (response) => {
        if (response && response.html && response.view_url) {
          this.response = response;
          const node_convert = document.createElement("div");
          node_convert.innerHTML = response.html;
          return resolve(node_convert.firstChild);
        } else {
          return reject(
            new Error("Placement is configured with invalid parameters.")
          );
        }
      };

      var script = document.createElement("script");
      script.src = url;
      script.type = "text/javascript";
      script.async = true;
      script.addEventListener("error", (err) => {
        // There was a problem loading this request, likely this was blocked by
        // an ad blocker. We'll resolve with an empty response instead of
        // throwing an error.
        return resolve();
      });
      document.getElementsByTagName("head")[0].appendChild(script);
    });
  }

  /* Detect whether this ad is "uplifted" meaning allowed by ABP's Acceptable Ads list
   *
   * Calls the provided callback passing a boolean whether this ad is uplifted.
   * We need this data to provide back to the AcceptableAds folks.
   *
   * This code comes directly from Eyeo/AdblockPlus team to measure Acceptable Ads.
   *
   * @static
   * @param {string} px - A URL of a pixel to test
   * @param {function) callback - A callback to call when finished
   */
  detectABP(px, callback) {
    var detected = false;
    var checksRemain = 2;
    var error1 = false;
    var error2 = false;
    if (typeof callback != "function") return;
    px += "?ch=*&rn=*";

    function beforeCheck(callback, timeout) {
      if (checksRemain == 0 || timeout > 1E3) callback(checksRemain == 0 && detected);
      else setTimeout(function() {
        beforeCheck(callback, timeout * 2)
      }, timeout * 2)
    }

    function checkImages() {
      if (--checksRemain) return;
      detected = !error1 && error2
    }
    var random = Math.random() * 11;
    var img1 = new Image;
    img1.onload = checkImages;
    img1.onerror = function() {
      error1 = true;
      checkImages()
    };
    img1.src = px.replace(/\*/, 1).replace(/\*/, random);
    var img2 = new Image;
    img2.onload = checkImages;
    img2.onerror = function() {
      error2 = true;
      checkImages()
    };
    img2.src = px.replace(/\*/, 2).replace(/\*/, random);
    beforeCheck(callback, 250)
  }

  /* Returns an array of keywords (strings) found on the page
   *
   * @returns {Array[string]} Advertising keywords found on the page
   */
  detectKeywords() {
    // Return previously detected keywords
    // If this code has already run.
    if (detectedKeywords.length > 0) return detectedKeywords;

    var keywordHist = {};  // Keywords found => count of keyword
    const mainContent = document.querySelector("[role='main']") ||
      document.querySelector("main") ||
      document.querySelector("body");

    const words = mainContent.textContent.split(/\s+/);
    const wordTrimmer = /^[\('"]?(.*?)[,\.\?\!:;\)'"]?$/g;
    for (let x = 0; x < words.length && x < MAX_WORDS_ANALYZED; x++) {
      // Remove certain punctuation from beginning and end of the word
      let word = words[x].replace(wordTrimmer, "$1").toLowerCase();
      if (KEYWORDS.hasOwnProperty(word)) {
        keywordHist[KEYWORDS[word]] = (keywordHist[KEYWORDS[word]] || 0) + 1;
      }
    }

    // Sort the hist with the most common items first
    // Grab only the MAX_KEYWORDS most common
    const keywords = Object.entries(keywordHist).filter(
      // Only consider a keyword with at least this many occurrences
      a => a[1] >= MIN_KEYWORD_OCCURRENCES
    ).sort(
      (a, b) => {
        if (a[1] > b[1]) return -1;
        if (a[1] < b[1]) return 1;
        return 0;
      }
    ).slice(0, MAX_KEYWORDS).map((x) => x[0]);

    detectedKeywords = keywords;

    return keywords;
  }
}

/* Detects whether the browser supports the necessary JS APIs to support the ad client
 *
 * Generally we support recent versions of evergreen browsers (Chrome, Firefox, Safari, Edge)
 * but we no longer support IE11.
 *
 *  @returns {boolean} true if all dependencies met and false otherwise
 */
export function check_dependencies() {
  if (
    !Object.entries ||
    !window.URL ||
    !window.URLSearchParams ||
    !window.Promise
  ) {
    console.error("Browser does not meet ethical ad client dependencies. Not showing ads");
    return false;
  }

  return true;
}

/* Find all placement DOM elements and hot load HTML as child nodes
 *
 * @param {boolean} force_load - load placements even if they are set to load manually
 * @returns {Promise<[Placement]>} Resolves to a list of Placement instances
 */
export function load_placements(force_load = false) {
  // Find all elements matching required data binding attribute.
  const node_list = document.querySelectorAll("[" + ATTR_PREFIX + "publisher]");
  let elements = Array.prototype.slice.call(node_list);

  // Create main promise. Iterator `all()` Promise will surround array of found
  // elements. If any of these elements have issues, this main promise will
  // reject.
  if (elements.length === 0) {
    throw new Error("No ad placements found.");
  }

  return Promise.all(
    elements.map((element, index) => {
      const placement = Placement.from_element(element);

      // Run AcceptableAds detection code
      // This lets us know how many impressions are attributed to AceeptableAds
      // Only run this once even for multiple placements
      // All impressions will be correctly attributed
      if (index === 0 && placement && !force_load) {
        placement.detectABP(ABP_DETECTION_PX, function (usesABP) {
          uplifted = usesABP;
          if (usesABP) {
            console.debug("Acceptable Ads enabled. Thanks for allowing our non-tracking ads :)");
          }
        });
      }

      if (placement && (force_load || !placement.load_manually)) {
        return placement.load();
      } else {
        // This will be manually loaded later or has already been loaded
        return null;
      }
    })
  );
}

// An error class that we will not surface to clients normally.
class EthicalAdsWarning extends Error {}

/* Wrapping Promise to allow for handling of errors by user
 *
 * This promise currently does not reject on error as this will emit a console
 * warning if the user hasn't added a promise rejection handler (which is most
 * cases).
 *
 * This promise resolves to an aray of Placement instances, or an empty list if
 * there was any error configuring the placements.
 *
 * For example, to perform an action when no placements are loaded:
 *
 *   <script>
 *   ethicalads.wait.then((placements) => {
 *     if (!placements.length) {
 *       console.log('Ads were not able to load');
 *     }
 *   }
 *   </script>
 *
 * @type {Promise<[Placement]>}
 */
export var wait;

/* Loading placements manually rather than the normal way
 *
 *   <div data-ea-publisher="..." data-ea-manual="true"></div>
 *   <script>
 *     ethicalads.load();
 *   </script>
 *
 * @type function
 */
export var load;

/* Whether this ad impression is attributed to being on the Acceptable Ads list.
 * @type boolean
 */
export var uplifted = false;

/* Keywords detected on the page
 * @type {Array[string]}
 */
export var detectedKeywords = [];

/* If importing this as a module, do not automatically process DOM and fetch the
 * ad placement. Only do this if using the module directly, from a `script`
 * element. This will allow for future extension and packaging as a module.
 *
 * This also replicates JQuery `$(document).ready()`, with added protection for
 * usage of `async` -- the DOM ready event can fire before the script is loaded..
 */
if (require.main !== module && check_dependencies()) {
  const wait_dom = new Promise((resolve) => {
    if (
      document.readyState === "interactive" ||
      document.readyState === "complete"
    ) {
      return resolve();
    } else {
      document.addEventListener(
        "DOMContentLoaded",
        () => {
          resolve();
        },
        {
          capture: true,
          once: true,
          passive: true,
        }
      );
    }
  });

  wait = new Promise((resolve) => {
    wait_dom.then(() => {
      load_placements()
        .then((placements) => {
          resolve(placements);
        })
        .catch((err) => {
          resolve([]);

          const is_debug = global.debug || window.debug || false;

          if (err instanceof Error) {
            if (err instanceof EthicalAdsWarning && !is_debug) {
              // Skip reporting these warnings for now, unless debugging.
              return;
            }
            console.error(err.message);
          }
        });
    });
  });

  load = () => {
    console.debug("Loading placements manually")
    load_placements(true);
  };
}

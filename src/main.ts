import JSSoup from 'jssoup';
import nodeFetch from 'node-fetch';
// @ts-ignore
// tslint:disable-next-line:no-var-requires
const fetch = require('fetch-cookie/node-fetch')(nodeFetch)

// tslint:disable:no-console

const HEADERS_SESSION = {
    'Accept': 'application/json, text/plain, */*',
    'Content-Type': 'application/json;charset=UTF-8',
    'User-Agent': 'Mozilla/5.0 (Linux; Android 6.0.1; D5803 Build/23.5.A.1.291; wv) \
        AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/63.0.3239.111 Mobile Safari/537.36'
}

const HEADERS_AUTH = {
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,\
        image/apng,*/*;q=0.8,application/signed-exchange;v=b3',
    'Content-Type': 'application/x-www-form-urlencoded',
    'User-Agent': 'Mozilla/5.0 (Linux; Android 6.0.1; D5803 Build/23.5.A.1.291; wv) \
        AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/63.0.3239.111 Mobile Safari/537.36'
}

const BASE_SESSION = 'https://www.portal.volkswagen-we.com/'
const BASE_AUTH = 'https://identity.vwgroup.io'


function makeCopy(obj: { [key: string]: string }): { [key: string]: string } {
    const newMap: { [key: string]: string } = {};
    // tslint:disable-next-line:forin
    for (const i in obj) {
        newMap[i] = obj[i];
    }
    return newMap;
}

function getJsonFromUrl(url: any) {
    if (!url) { url = location.href };
    const question = url.indexOf("?");
    let hash = url.indexOf("#");
    if (hash === -1 && question === -1) { return {} };
    if (hash === -1) { hash = url.length };
    const query = question === -1 || hash === question + 1 ? url.substring(hash) :
        url.substring(question + 1, hash);
    const result: { [key: string]: any } = {};
    query.split("&").forEach((part: string) => {
        if (!part) { return };
        part = part.split("+").join(" "); // replace every + with space, regexp-free version
        const eq = part.indexOf("=");
        let key = eq > -1 ? part.substr(0, eq) : part;
        const val = eq > -1 ? decodeURIComponent(part.substr(eq + 1)) : "";
        const from = key.indexOf("[");
        if (from === -1) {
            result[decodeURIComponent(key)] = val
        } else {
            const to = key.indexOf("]", from);
            const index = decodeURIComponent(key.substring(from + 1, to));
            key = decodeURIComponent(key.substring(0, from));
            if (!result[key]) {
                result[key] = []
            }
            if (!index) {
                result[key].push(val)
            } else {
                result[key][index] = val
            }
        }
    });
    return result;
}

class Connection {

    private agent: any;
    private sessionHeaders: { [key: string]: string };
    private sessionBase: string;
    private sessionAuthHeaders: { [key: string]: string };
    private sessionAuthBase: string;
    private sessionAuthRefUrl: string;
    private sessionFirstUpdate: boolean;
    private sessionAuthUsername: string;
    private sessionAuthPassword: string;
    private state: { [key: string]: any };

    constructor(agent: any, username: string, password: string) {
        this.agent = agent
        this.sessionHeaders = makeCopy(HEADERS_SESSION)
        this.sessionBase = BASE_SESSION
        this.sessionAuthHeaders = makeCopy(HEADERS_AUTH)
        this.sessionAuthBase = BASE_AUTH
        this.sessionAuthRefUrl = ""
        this.sessionFirstUpdate = false
        this.sessionAuthUsername = username
        this.sessionAuthPassword = password

        this.state = {}
    }

    public async login(): Promise<boolean> {
        // """ Reset session in case we would like to login again """
        this.sessionHeaders = makeCopy(HEADERS_SESSION)
        this.sessionAuthHeaders = makeCopy(HEADERS_AUTH)

        const extractCSRF = (req: string): string => {
            const r = /<meta name="_csrf" content="([^"]*)?"\/>/i;
            const items = req.match(r);
            return items![1];
        }

        try {
            // Request landing page and get CSFR:
            let req = await fetch(this.sessionBase + '/portal/en_GB/web/guest/home',
                {
                    method: "GET",
                })

            if (req.status !== 200) {
                return false
            }

            const text = await req.text();
            let csrf = extractCSRF(text);

            // Request login page and get CSRF
            this.sessionAuthHeaders.Referer = this.sessionBase + 'portal'
            req = await fetch(this.sessionBase + "portal/web/guest/home/-/csrftokenhandling/get-login-url",
                {
                    method: "POST",
                    headers: this.sessionAuthHeaders,
                    redirect: "follow",
                })

            if (req.status !== 200) {
                return false
            }

            // console.log(await req.text());
            const responseData = await req.json()
            const lgUrl = responseData.loginURL.path;

            // no redirect so we can get values we look for
            req = await fetch(lgUrl,
                {
                    method: "GET",
                    redirect: "manual",
                    headers: this.sessionAuthHeaders,
                })

            if (req.status !== 302) {
                return false
            }

            const refUrl1 = req.headers.get("location")

            // now get actual login page and get session id and ViewState
            req = await fetch(refUrl1!,
                {
                    method: "GET",
                    headers: this.sessionAuthHeaders,
                })

            if (req.status !== 200) {
                return false
            }

            let content = await req.text()

            const getInput = (data: string, name: string): string => {
                const soup = new JSSoup(data);
                const items = soup.findAll('input');
                for (const item of items) {
                    if (item.attrs.name === name) {
                        return item.attrs.value;
                    }
                }
                return ""
            }
            const getForm = (data: string, name: string): string => {
                const soup = new JSSoup(data);
                const items = soup.findAll('form');
                for (const item of items) {
                    if (item.attrs.id === name) {
                        return item.attrs.action;
                    }
                }
                return ""
            }

            const loginCsrf = getInput(content, "_csrf")
            const loginToken = getInput(content, "relayState")
            const loginHmac = getInput(content, "hmac")
            const loginFormAction = getForm(content, "emailPasswordForm");


            // get login variables
            const loginUrl = this.sessionAuthBase + loginFormAction

            // post login
            this.sessionAuthHeaders.Referer = refUrl1!

            let postData: { [key: string]: any } = {
                'email': this.sessionAuthUsername,
                'password': this.sessionAuthPassword,
                'relayState': loginToken,
                'hmac': loginHmac,
                '_csrf': loginCsrf,
            }

            // post: https://identity.vwgroup.io/signin-service/v1/xxx@apps_vw-dilab_com/login/identifier

            const toUrlEncoded = (obj: any) => Object.keys(obj).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(obj[k])).join('&');
            req = await fetch(loginUrl,
                {
                    method: "POST",
                    redirect: "manual",
                    body: toUrlEncoded(postData),
                    headers: this.sessionAuthHeaders,
                })

            if (req.status !== 303) {
                return false
            }

            const refUrl2 = req.headers.get("location")
            const authRelayUrl = refUrl2


            // get: https://identity.vwgroup.io/signin-service/v1/xxx@apps_vw-dilab_com/login/authenticate?relayState=xxx&email=xxx
            req = await fetch(authRelayUrl,
                {
                    method: "GET",
                    redirect: "manual",
                    // body: toUrlEncoded(postData),
                    headers: this.sessionAuthHeaders,
                })

            if (req.status !== 200) {
                return false
            }

            content = await req.text();


            const authCsrf = getInput(content, "_csrf")
            const authToken = getInput(content, "relayState")
            const authHmac = getInput(content, "hmac")
            const authFormAction = getForm(content, "credentialsForm");


            // post: https://identity.vwgroup.io/signin-service/v1/xxx@apps_vw-dilab_com/login/authenticate
            const authUrl = this.sessionAuthBase + authFormAction;

            // post login
            this.sessionAuthHeaders.Referer = authRelayUrl

            postData = {
                'email': this.sessionAuthUsername,
                'password': this.sessionAuthPassword,
                'relayState': authToken,
                'hmac': authHmac,
                '_csrf': authCsrf,
            }
            // post: https://identity.vwgroup.io/signin-service/v1/xxx@apps_vw-dilab_com/login/authenticate
            req = await fetch(authUrl!,
                {
                    method: "POST",
                    headers: this.sessionAuthHeaders,
                    redirect: "manual",
                    body: toUrlEncoded(postData),
                })

            if (req.status !== 302) {
                return false
            }

            // get: https://identity.vwgroup.io/oidc/v1/oauth/sso?clientId=xxx@apps_vw-dilab_com&relayState=xxx&userId=xxx&HMAC=xxx
            const refUrl3 = req.headers.get('location')
            req = await fetch(refUrl3!,
                {
                    method: "GET",
                    headers: this.sessionAuthHeaders,
                    redirect: "manual",
                })

            if (req.status !== 302) {
                return false
            }

            // get:
            // https://identity.vwgroup.io/consent/v1/users/xxx/xxx@apps_vw-dilab_com?scopes=openid%20profile%20birthdate%20nickname%20address%20email%20phone%20cars%20dealers%20mbb&relaystate=xxx&callback=https://identity.vwgroup.io/oidc/v1/oauth/client/callback&hmac=xxx
            const refUrl4 = req.headers.get('location')
            req = await fetch(refUrl4!,
                {
                    method: "GET",
                    headers: this.sessionAuthHeaders,
                    redirect: "manual",
                })

            if (req.status !== 302) {
                return false
            }

            // get:
            // https://identity.vwgroup.io/oidc/v1/oauth/client/callback/success?user_id=xxx&client_id=xxx@apps_vw-dilab_com&scopes=openid%20profile%20birthdate%20nickname%20address%20email%20phone%20cars%20dealers%20mbb&consentedScopes=openid%20profile%20birthdate%20nickname%20address%20email%20phone%20cars%20dealers%20mbb&relaystate=xxx&hmac=xxx
            const refUrl5 = req.headers.get('location')
            // user_id = parse_qs(urlparse(refUrl5).query).get('user_id')[0]
            req = await fetch(refUrl5!,
                {
                    method: "GET",
                    headers: this.sessionAuthHeaders,
                    redirect: "manual",
                })

            if (req.status !== 302) {
                return false
            }

            // get: https://www.portal.volkswagen-we.com/portal/web/guest/complete-login?state=xxx&code=xxx
            const refUrl6 = req.headers.get('location')
            const parsedUrl = getJsonFromUrl(refUrl6);

            const state = parsedUrl.state;
            const code = parsedUrl.code

            // post:
            // https://www.portal.volkswagen-we.com/portal/web/guest/complete-login?p_auth=xxx&p_p_id=33_WAR_cored5portlet&p_p_lifecycle=1&p_pstate=normal&p_p_mode=view&p_p_col_id=column-1&p_p_col_count=1&_33_WAR_cored5portlet_javax.portlet.action=getLoginStatus
            this.sessionAuthHeaders.Referer = refUrl6!
            postData = {
                '_33_WAR_cored5portlet_code': code,
                '_33_WAR_cored5portlet_landingPageUrl': ''
            }
            const url = refUrl6.split("?")[0]

            const url2 = url + "?p_auth=" + state + "&p_p_id=33_WAR_cored5portlet&p_p_lifecycle=1&p_p_state=normal&p_p_mode=view&p_p_col_id=column-1&p_p_col_count=1&_33_WAR_cored5portlet_javax.portlet.action=getLoginStatus"

            req = await fetch(url2,
                {
                    method: "POST",
                    headers: this.sessionAuthHeaders,
                    redirect: "manual",
                    body: toUrlEncoded(postData),
                    timeout: 10000,
                })

            if (req.status !== 302) {
                return false
            }

            // get: https://www.portal.volkswagen-we.com/portal/user/xxx/v_8xxx
            const refUrl7 = req.headers.get('location')
            req = await fetch(refUrl7!,
                {
                    method: "GET",
                    headers: this.sessionAuthHeaders,
                    redirect: "manual",
                })

            if (req.status !== 200) {
                return false
            }

            // We have a new CSRF
            csrf = extractCSRF(await req.text())

            // cookie = this.session.cookies.get_dict()
            // cookie = req.cookies

            // this.session_guest_language_id = extract_guest_language_id(req.cookies.get('GUEST_LANGUAGE_ID').value)

            // Update headers for requests
            this.sessionHeaders.Referer = refUrl7!
            this.sessionHeaders['X-CSRF-Token'] = csrf
            this.sessionAuthRefUrl = refUrl7 + '/'
            return true
        } catch (e) {
            console.log(e);
            return false;
        }
    }

    public async logout() {
        await this.post('-/logout/revoke', undefined, undefined)
    }

    public async update() {
        // """Update status."""
        try {
            if (this.sessionFirstUpdate) {
                if (!await this.validate_login()) {
                    console.warn('Session expired, creating new login session to carnet.')
                    await this.login()
                }
            } else {
                this.sessionFirstUpdate = true
            }

            // // fetch vehicles
            // console.log('Fetching vehicles')
            // // owners_verification = this.post(`/portal/group/{this.session_guest_language_id}/edit-profile/-/profile/get-vehicles-owners-verification`)

            // // get vehicles
            let loadedVehicles = await this.post(
                '-/mainnavigation/get-fully-loaded-cars',
                undefined, undefined
            )
            console.log(loadedVehicles)

            // // load all not loaded vehicles
            if (loadedVehicles.fullyLoadedVehiclesResponse && loadedVehicles.fullyLoadedVehiclesResponse.vehiclesNotFullyLoaded) {
                for (const vehicle of loadedVehicles.fullyLoadedVehiclesResponse.vehiclesNotFullyLoaded) {
                    const vehicleVin = vehicle.vin
                    await this.post(
                        '-/mainnavigation/load-car-details/' + vehicleVin,
                        undefined, undefined
                    )
                }

                loadedVehicles = await this.post(
                    '-/mainnavigation/get-fully-loaded-cars',
                    undefined, undefined
                )
            }
            if (loadedVehicles.fullyLoadedVehiclesResponse && loadedVehicles.fullyLoadedVehiclesResponse.completeVehicles) {
                // // update vehicles
                for (const vehicle of loadedVehicles.fullyLoadedVehiclesResponse.completeVehicles) {
                    const vehicleUrl = this.sessionBase + vehicle.dashboardUrl;
                    if (!this.state[vehicleUrl]) {
                        this.state[vehicleUrl] = vehicle
                    } else {
                        for (const key of Object.keys(vehicle)) {
                            this.state[vehicleUrl][key] = vehicle[key];
                        }
                    }
                }
            }

            for (const vehicle of Object.keys(this.state)) {
                await this.update_vehicle(vehicle)
            }
            return true
        } catch (e) {
            console.log(e)
        }
    }

    private async request(method: string, url: string, data: any | undefined) {
        // """Perform a query to the vw carnet"""
        // //    // try:
        // console.log("Request for %s", url)
        const options: { [key: string]: any } = {
            method,
            headers: this.sessionHeaders,
            redirect: "manual",
        }
        if (data) {
            options.body = JSON.stringify(data);
        }
        const req = await fetch(url,
            options)

        const res = await req.json()
        // console.log(`Received [{response.status}] response: {res}`)
        return res
        // // // except Exception as error:
        // // //     _LOGGER.warning(
        // // //         "Failure when communcating with the server: %s", error
        // #)
        // // //     raise
    }

    private make_url(ref: string, rel: string | undefined): string {
        console.log(`MAKE_URL ref=${ref} rel=${rel}`)
        if (rel) {
            console.log("relative")
            return rel + "/" + ref;
        }
        console.log("add abs")
        return this.sessionAuthRefUrl + "/" + ref
    }

    private async get(url: string, rel: string | undefined) {
        //  """Perform a get query to the online service."""
        return await this.request("GET", this.make_url(url, rel), undefined)
    }

    private async post(url: string, rel: string | undefined, data: any) {
        //   """Perform a post query to the online service."""
        if (data) {
            return await this.request("POST", this.make_url(url, rel), data)
        } else {
            return await this.request("POST", this.make_url(url, rel), undefined)
        }
    }
    private async validate_login(): Promise<boolean> {
        const messages = await this.post('-/msgc/get-new-messages', undefined, undefined)
        return messages.errorCode === "0"
    }



    private async update_vehicle(vehurl: string) {
        const url = vehurl;

        // get new messages, needs to be here fot be able to get latest vehicle status
        try {
            const response = await this.post('-/msgc/get-new-messages', url, undefined)
            // messageList
            if (response.errorCode === '0') {
                this.state[url].vehicleMessagesNew = response.response
            } else {
                console.log(`Could not fetch new messages: ${response}`)
            }
        } catch (e) {

            //   except Exception as err:
            console.log(`Could not fetch new messages, error: ${e}`)
        }

        // get latest messages
        try {
            const response = await this.post('-/msgc/get-latest-messages', url, undefined)
            // messageList
            if (response.errorCode === '0') {
                this.state[url].vehicleMessagesLatest = response.messageList

            } else {
                console.log(`Could not fetch latest messages: ${response}`)
            }
        }
        catch (err) {
            console.log(`Could not fetch latest messages, error: ${err}`)
        }

        // fetch vehicle status data
        try {
            const response = await this.post('-/vsr/get-vsr', url, undefined)
            // messageList
            if (response.errorCode === '0') {
                this.state[url].vehicleStatus = response.vehicleStatusData

            } else {
                console.log(`Could not fetch vsr: ${response}`)
            }
        }
        catch (err) {
            console.log(`Could not fetch vsr messages, error: ${err}`)
        }


        // fetch vehicle emanage data
        // TODO: check only for vehicles without engineTypecombustian
        try {
            const response = await this.post('-/emanager/get-emanager', url, undefined)
            // messageList
            if (response.errorCode === '0') {
                this.state[url].EManager = response.EManager

            } else {
                console.log(`Could not fetch e manager: ${response}`)
            }
        }
        catch (err) {
            console.log(`Could not fetch e manager messages, error: ${err}`)
        }
        // fetch vehicle location data
        try {
            const response = await this.post('-/cf/get-location', url, undefined)
            // messageList
            if (response.errorCode === '0') {
                this.state[url].vehiclePosition = response.position

            } else {
                console.log(`Could not fetch position: ${response}`)
            }
        }
        catch (err) {
            console.log(`Could not fetch position messages, error: ${err}`)
        }

        // fetch vehicle details data
        try {
            const response = await this.post('-/vehicle-info/get-vehicle-details', url, undefined)
            // messageList
            if (response.errorCode === '0') {
                this.state[url].vehicleDetails = response.vehicleDetails

            } else {
                console.log(`Could not fetch vehicle details: ${response}`)
            }
        }
        catch (err) {
            console.log(`Could not fetch vehicle details messages, error: ${err}`)
        }

        // fetch combustion engine remote auxiliary heating status data
        // if vehicle.attrs.get('engineTypeCombustian', False):
        try {
            const response = await this.post('-/rah/get-status', url, undefined)
            // messageList
            if (response.errorCode === '0') {
                this.state[url].vehicleRemoteAuxiliaryHeating = response.remoteAuxiliaryHeating

            } else {
                console.log(`Could not fetch vehicle vehicleRemoteAuxiliaryHeating: ${response}`)
            }
        }
        catch (err) {
            console.log(`Could not fetch vehicle vehicleRemoteAuxiliaryHeating messages, error: ${err}`)
        }

        // fetch latest trips
        try {
            const response = await this.post('-/rts/get-latest-trip-statistics', url, undefined)
            // messageList
            if (response.errorCode === '0') {
                this.state[url].vehicleLastTrips = response.rtsViewModel

            } else {
                console.log(`Could not fetch vehicle vehicleLastTrips: ${response}`)
            }
        }
        catch (err) {
            console.log(`Could not fetch vehicle vehicleLastTrips messages, error: ${err}`)
        }
    }
}

import JSSoup from 'jssoup';
const nodeFetch = require('node-fetch')
// @ts-ignore
const fetch = require('fetch-cookie/node-fetch')(nodeFetch)

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
    for (var i in obj) {
        newMap[i] = obj[i];
    }
    return newMap;
}

function getJsonFromUrl(url: any) {
    if (!url) url = location.href;
    var question = url.indexOf("?");
    var hash = url.indexOf("#");
    if (hash == -1 && question == -1) return {};
    if (hash == -1) hash = url.length;
    var query = question == -1 || hash == question + 1 ? url.substring(hash) :
        url.substring(question + 1, hash);
    var result: { [key: string]: any } = {};
    query.split("&").forEach(function (part: string) {
        if (!part) return;
        part = part.split("+").join(" "); // replace every + with space, regexp-free version
        var eq = part.indexOf("=");
        var key = eq > -1 ? part.substr(0, eq) : part;
        var val = eq > -1 ? decodeURIComponent(part.substr(eq + 1)) : "";
        var from = key.indexOf("[");
        if (from == -1) result[decodeURIComponent(key)] = val;
        else {
            var to = key.indexOf("]", from);
            var index = decodeURIComponent(key.substring(from + 1, to));
            key = decodeURIComponent(key.substring(0, from));
            if (!result[key]) result[key] = [];
            if (!index) result[key].push(val);
            else result[key][index] = val;
        }
    });
    return result;
}

class Connection {

    agent: any;
    session_headers: { [key: string]: string };
    session_base: string;
    session_auth_headers: { [key: string]: string };
    session_auth_base: string;
    session_guest_language_id: string;
    session_auth_ref_url: string;
    session_logged_in: boolean;
    session_first_update: boolean;
    session_auth_username: string;
    session_auth_password: string;
    state: { [key: string]: any };

    constructor(agent: any, username: string, password: string, guest_lang: string = 'en') {
        this.agent = agent
        this.session_headers = makeCopy(HEADERS_SESSION)
        this.session_base = BASE_SESSION
        this.session_auth_headers = makeCopy(HEADERS_AUTH)
        this.session_auth_base = BASE_AUTH
        this.session_guest_language_id = guest_lang
        this.session_auth_ref_url = ""
        this.session_logged_in = false
        this.session_first_update = false
        this.session_auth_username = username
        this.session_auth_password = password

        console.debug('Using service', this.session_base)

        this.state = {}
    }

    public async login(): Promise<boolean> {
        // """ Reset session in case we would like to login again """
        this.session_headers = makeCopy(HEADERS_SESSION)
        this.session_auth_headers = makeCopy(HEADERS_AUTH)

        const extract_csrf = (req: string): string => {
            const r = /<meta name="_csrf" content="([^"]*)?"\/>/i;
            const items = req.match(r);
            // console.log(items);
            return items![1];
            // return req!.match()[1]!;
            //return re.compile('<meta name="_csrf" content="([^"]*)"/>').search(req).group(1)
        }

        const extract_guest_language_id = (req: string): string => {
            return req.split('_')[1].toLowerCase();
        }

        try {
            // Request landing page and get CSFR:
            let req = await fetch(this.session_base + '/portal/en_GB/web/guest/home',
                {
                    method: "GET",
                })

            if (req.status != 200) {
                console.log("1");
                console.log(req)
                return false
            }

            let text = await req.text();
            //console.log("1", text);
            let csrf = extract_csrf(text);
            console.log("CSRF", csrf)

            // Request login page and get CSRF
            this.session_auth_headers['Referer'] = this.session_base + 'portal'
            req = await fetch(this.session_base + "portal/web/guest/home/-/csrftokenhandling/get-login-url",
                {
                    method: "POST",
                    headers: this.session_auth_headers,
                    redirect: "follow",
                })

            if (req.status != 200) {
                console.log("2");
                console.log(req)
                return false
            }

            // console.log(await req.text());
            const response_data = await req.json()
            const lg_url = response_data.loginURL.path;

            // no redirect so we can get values we look for
            req = await fetch(lg_url,
                {
                    method: "GET",
                    redirect: "manual",
                    headers: this.session_auth_headers,
                })

            if (req.status != 302) {
                console.log("3");
                console.log(req)
                return false
            }

            const ref_url_1 = req.headers.get("location")

            // now get actual login page and get session id and ViewState
            req = await fetch(ref_url_1!,
                {
                    method: "GET",
                    headers: this.session_auth_headers,
                })

            if (req.status != 200) {
                console.log("4");
                console.log(req)
                return false
            }

            let content = await req.text()
            //console.log(content);

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

            let login_csrf = getInput(content, "_csrf")
            let login_token = getInput(content, "relayState")
            let login_hmac = getInput(content, "hmac")
            let login_form_action = getForm(content, "emailPasswordForm");


            // get login variables
            // bs = BeautifulSoup(await req.text(), 'html.parser')
            // login_csrf = bs.select_one('input[name=_csrf]')['value']
            // login_token = bs.select_one('input[name=relayState]')['value']
            // login_hmac = bs.select_one('input[name=hmac]')['value']
            // login_form_action = bs.find('form', id = 'emailPasswordForm').get('action')
            const login_url = this.session_auth_base + login_form_action

            // post login
            this.session_auth_headers["Referer"] = ref_url_1!

            let post_data: { [key: string]: any } = {
                'email': this.session_auth_username,
                'password': this.session_auth_password,
                'relayState': login_token,
                'hmac': login_hmac,
                '_csrf': login_csrf,
            }
            console.log(post_data);
            // post: https://identity.vwgroup.io/signin-service/v1/xxx@apps_vw-dilab_com/login/identifier
            console.log(login_url)
            const toUrlEncoded = (obj: any) => Object.keys(obj).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(obj[k])).join('&');
            req = await fetch(login_url,
                {
                    method: "POST",
                    redirect: "manual",
                    body: toUrlEncoded(post_data),
                    headers: this.session_auth_headers,
                })

            if (req.status != 303) {
                console.log("5");
                console.log(req)
                return false
            }

            const ref_url_2 = req.headers.get("location")
            const auth_relay_url = ref_url_2


            // get: https://identity.vwgroup.io/signin-service/v1/xxx@apps_vw-dilab_com/login/authenticate?relayState=xxx&email=xxx
            req = await fetch(auth_relay_url,
                {
                    method: "GET",
                    redirect: "manual",
                    // body: toUrlEncoded(post_data),
                    headers: this.session_auth_headers,
                })

            if (req.status != 200) {
                console.log("5");
                console.log(req)

                return false
            }

            content = await req.text();


            const auth_csrf = getInput(content, "_csrf")
            const auth_token = getInput(content, "relayState")
            const auth_hmac = getInput(content, "hmac")
            const auth_form_action = getForm(content, "credentialsForm");


            // post: https://identity.vwgroup.io/signin-service/v1/xxx@apps_vw-dilab_com/login/authenticate
            // bs = BeautifulSoup(await req.text(), 'html.parser')
            // auth_csrf = bs.select_one('input[name=_csrf]')['value']
            // auth_token = bs.select_one('input[name=relayState]')['value']
            // auth_hmac = bs.select_one('input[name=hmac]')['value']
            // auth_form_action = bs.find('form', id = 'credentialsForm').get('action')
            const auth_url = this.session_auth_base + auth_form_action;

            // post login
            this.session_auth_headers['Referer'] = auth_relay_url

            post_data = {
                'email': this.session_auth_username,
                'password': this.session_auth_password,
                'relayState': auth_token,
                'hmac': auth_hmac,
                '_csrf': auth_csrf,
            }
            // post: https://identity.vwgroup.io/signin-service/v1/xxx@apps_vw-dilab_com/login/authenticate
            req = await fetch(auth_url!,
                {
                    method: "POST",
                    headers: this.session_auth_headers,
                    redirect: "manual",
                    body: toUrlEncoded(post_data),
                })

            if (req.status != 302) {
                console.log("6");
                console.log(req)

                return false
            }

            // get: https://identity.vwgroup.io/oidc/v1/oauth/sso?clientId=xxx@apps_vw-dilab_com&relayState=xxx&userId=xxx&HMAC=xxx
            const ref_url_3 = req.headers.get('location')
            req = await fetch(ref_url_3!,
                {
                    method: "GET",
                    headers: this.session_auth_headers,
                    redirect: "manual",
                })

            if (req.status != 302) {
                console.log("7");
                console.log(req)

                return false
            }

            // get:
            // https://identity.vwgroup.io/consent/v1/users/xxx/xxx@apps_vw-dilab_com?scopes=openid%20profile%20birthdate%20nickname%20address%20email%20phone%20cars%20dealers%20mbb&relaystate=xxx&callback=https://identity.vwgroup.io/oidc/v1/oauth/client/callback&hmac=xxx
            const ref_url_4 = req.headers.get('location')
            req = await fetch(ref_url_4!,
                {
                    method: "GET",
                    headers: this.session_auth_headers,
                    redirect: "manual",
                })

            if (req.status != 302) {
                console.log("8");
                console.log(req)

                return false
            }

            // get:
            // https://identity.vwgroup.io/oidc/v1/oauth/client/callback/success?user_id=xxx&client_id=xxx@apps_vw-dilab_com&scopes=openid%20profile%20birthdate%20nickname%20address%20email%20phone%20cars%20dealers%20mbb&consentedScopes=openid%20profile%20birthdate%20nickname%20address%20email%20phone%20cars%20dealers%20mbb&relaystate=xxx&hmac=xxx
            const ref_url_5 = req.headers.get('location')
            // user_id = parse_qs(urlparse(ref_url_5).query).get('user_id')[0]
            req = await fetch(ref_url_5!,
                {
                    method: "GET",
                    headers: this.session_auth_headers,
                    redirect: "manual",
                })

            if (req.status != 302) {
                console.log("9");
                console.log(req)

                return false
            }

            // get: https://www.portal.volkswagen-we.com/portal/web/guest/complete-login?state=xxx&code=xxx
            const ref_url_6 = req.headers.get('location')
            const parsed_url = getJsonFromUrl(ref_url_6);
            console.log(ref_url_6)


            const state = parsed_url.state;
            const code = parsed_url.code

            // post:
            // https://www.portal.volkswagen-we.com/portal/web/guest/complete-login?p_auth=xxx&p_p_id=33_WAR_cored5portlet&p_p_lifecycle=1&p_pstate=normal&p_p_mode=view&p_p_col_id=column-1&p_p_col_count=1&_33_WAR_cored5portlet_javax.portlet.action=getLoginStatus
            this.session_auth_headers['Referer'] = ref_url_6!
            post_data = {
                '_33_WAR_cored5portlet_code': code,
                '_33_WAR_cored5portlet_landingPageUrl': ''
            }
            const url = ref_url_6.split("?")[0]
            //const url = "https://www.portal.volkswagen-we.com/portal/web/guest/complete-login"
            const url2 = url + "?p_auth=" + state + "&p_p_id=33_WAR_cored5portlet&p_p_lifecycle=1&p_p_state=normal&p_p_mode=view&p_p_col_id=column-1&p_p_col_count=1&_33_WAR_cored5portlet_javax.portlet.action=getLoginStatus"

            console.log("**", url2)

            req = await fetch(url2,
                {
                    method: "POST",
                    headers: this.session_auth_headers,
                    redirect: "manual",
                    body: toUrlEncoded(post_data),
                    timeout: 10000,
                })

            if (req.status != 302) {
                console.log("10");
                console.log(req)

                return false
            }

            // get: https://www.portal.volkswagen-we.com/portal/user/xxx/v_8xxx
            const ref_url_7 = req.headers.get('location')
            req = await fetch(ref_url_7!,
                {
                    method: "GET",
                    headers: this.session_auth_headers,
                    redirect: "manual",
                })

            if (req.status != 200) {
                return false
            }

            // We have a new CSRF
            csrf = extract_csrf(await req.text())

            // cookie = this.session.cookies.get_dict()
            // cookie = req.cookies

            // this.session_guest_language_id = extract_guest_language_id(req.cookies.get('GUEST_LANGUAGE_ID').value)

            // Update headers for requests
            this.session_headers['Referer'] = ref_url_7!
            this.session_headers['X-CSRF-Token'] = csrf
            this.session_auth_ref_url = ref_url_7 + '/'
            this.session_logged_in = true
            return true
        } catch (e) {
            console.log(e);
            return false;
        }
    }

    async request(method: string, url: string, data: any | undefined) {
        //"""Perform a query to the vw carnet"""
        // //    // try:
        // console.log("Request for %s", url)
        const options: { [key: string]: any } = {
            method,
            headers: this.session_headers,
            redirect: "manual",
        }
        if (data) {
            options.body = JSON.stringify(data);
        }
        const req = await fetch(url,
            options)

        const res = await req.json()
        //console.log(`Received [{response.status}] response: {res}`)
        return res
        // // // except Exception as error:
        // // //     _LOGGER.warning(
        // // //         "Failure when communcating with the server: %s", error
        // #)
        // // //     raise
    }
    async logout() {
        await this.post('-/logout/revoke', undefined, undefined)
    }

    make_url(ref: string, rel: string | undefined): string {
        console.log(`MAKE_URL ref=${ref} rel=${rel}`)
        if (rel) {
            console.log("relative")
            return rel + "/" + ref;
        }
        console.log("add abs")
        return this.session_auth_ref_url + "/" + ref
    }

    async get(url: string, rel: string | undefined) {
        //  """Perform a get query to the online service."""
        return await this.request("GET", this.make_url(url, rel), undefined)
    }

    async post(url: string, rel: string | undefined, data: any) {
        //   """Perform a post query to the online service."""
        if (data) {
            return await this.request("POST", this.make_url(url, rel), data)
        } else {
            return await this.request("POST", this.make_url(url, rel), undefined)
        }
    }
    async validate_login(): Promise<boolean> {
        const messages = await this.post('-/msgc/get-new-messages', undefined, undefined)
        return messages.errorCode === "0"
    }

    async update() {
        //"""Update status."""
        try {
            if (this.session_first_update) {
                if (!await this.validate_login()) {
                    console.warn('Session expired, creating new login session to carnet.')
                    await this.login()
                }
            } else {
                this.session_first_update = true
            }

            // // fetch vehicles
            // console.log('Fetching vehicles')
            // // owners_verification = this.post(`/portal/group/{this.session_guest_language_id}/edit-profile/-/profile/get-vehicles-owners-verification`)

            // // get vehicles
            let loaded_vehicles = await this.post(
                '-/mainnavigation/get-fully-loaded-cars',
                undefined, undefined
            )
            console.log(loaded_vehicles)

            // // load all not loaded vehicles
            if (loaded_vehicles.fullyLoadedVehiclesResponse && loaded_vehicles.fullyLoadedVehiclesResponse.vehiclesNotFullyLoaded) {
                for (const vehicle of loaded_vehicles.fullyLoadedVehiclesResponse.vehiclesNotFullyLoaded) {
                    const vehicle_vin = vehicle.vin
                    await this.post(
                        '-/mainnavigation/load-car-details/' + vehicle_vin,
                        undefined, undefined
                    )
                }

                loaded_vehicles = await this.post(
                    '-/mainnavigation/get-fully-loaded-cars',
                    undefined, undefined
                )
            }
            if (loaded_vehicles.fullyLoadedVehiclesResponse && loaded_vehicles.fullyLoadedVehiclesResponse.completeVehicles) {
                // // update vehicles
                for (const vehicle of loaded_vehicles.fullyLoadedVehiclesResponse.completeVehicles) {
                    const vehicle_url = this.session_base + vehicle.dashboardUrl;
                    if (!this.state[vehicle_url]) {
                        this.state[vehicle_url] = vehicle
                    } else {
                        for (const key of Object.keys(vehicle)) {
                            this.state[vehicle_url][key] = vehicle[key];
                        }
                    }
                }
            }

            for (const vehicle of Object.keys(this.state)) {
                await this.update_vehicle(vehicle)
            }
            /*
 

 
// // get vehicle data
for vehicle in this.vehicles:
    // // update data in all vehicles
    await vehicle.update() */
            return true
        } catch (e) {
            //        _LOGGER.warning(`Could not update information from carnet: {error}`)
            console.log(e)

        }
    }

    async update_vehicle(vehurl: string) {//vehicle: any) {
        const url = vehurl;
        console.log(`Updating vehicle status {vehicle.vin}`)

        // get new messages, needs to be here fot be able to get latest vehicle status
        try {
            let response = await this.post('-/msgc/get-new-messages', url, undefined)
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

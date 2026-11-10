// This module contains function to get (read) data from Cosmic and Pascal
// It creates the "kortnotation" property for both Cosmic and Pascal by calling functions in the kortnotation module
//if (typeof pascalApp == "undefined") pascalApp = "dynamic"

// Cosmic medication status handled
var statusHandled = ["ACTIVE", "PAUSED", "PLANNED", "PLANNED", "FUTURE_DISCONTINUED", "FUTURE_PLANNED"]; // || med.status == "UNPLANNED"
exports.statusHandled = statusHandled;

//============================================================= Validate same patient in Cosmic and Pascal ========================================================*

exports.validatePatient = function (pid, fixedData) {
    Log.info(logTag, "Info: validatePatient");
    const pidErrorText = "Det går inte att verifiera att det är samma patient i Cosmic och Pascal.";
    if (fixedData) {
        return;
    }
    // Verify Cosmic pid
    let pInfo = cosmic.patientId();
    let readPid = pInfo.idno.replace(/ +/g, "").replace(/-/g, "").replace(/\,/g, "").trim();
    if (pid != readPid) {
        throw pidErrorText;
    }
    // Verify Pascal pid
    try {
        if (pascalApp == "dynamic") {
            var pascalPid = new Field("**/ssn/div#1", dynamicPascal).read().text.replace(/-/g, "").trim();
            if (pid != pascalPid) {
                throw pidErrorText;
            }
        } else {
            var result = Flow.run("Pascal verify patient", { pid: pid }).samePatient;
            if (result != "True") {
                throw "Det är inte samma patient i Cosmic och Pascal."
            }
        }
    } catch (e) {
        Log.info(logTag, "logError: validatePatient " + e);
        throw pidErrorText;
    }
}


//======================================================================== READ COSMIC DATA ========================================================================*
exports.getCosmicData = function () {
    try {
        // Get framtida förskrivninger
        Log.info(logTag, "Reading Förskrivningsöversikt");
        var framtida = [];
        try {
            Window.focus({ askForPermission: false });
            medicationModule.openForskrivningTab();
            framtida = medicationModule.getForskrivning();
            // If error in reading (retun false) or an ordiation has more than 2 periods then do not do comparison on this ATC
            medicationModule.openLakemedelList();
            Wait.forSeconds(1); // To avoid Cosmic crash
        } catch (e) {
            Log.info(logTag, "logError: Finding multi dose on Förskrivning list failed: " + (e.stack || e));
            throw "Framtida förskrivningar kunde inte läsas.";
        }
        var forskrivningarToFind = framtida.length; // When matching the same number of ordinations must be found in läkemedelslistan
        Log.info(logTag, "framtida.length, JSON.stringify(framtida): " + framtida.length + " " + JSON.stringify(framtida))
        // if (FL) Dialog.info(framtida.length, JSON.stringify(framtida))
        var forskrivningarFound = 0;

        // Get data from läkemedellistan
        Log.info(logTag, "Reading Cosmic LM list");
        var drugTable = new Field("**/drugList_jscrollpane_container/JViewport/DrugListTable");
        if (!drugTable.exists()) {
            throw "Flödet måste startas från läkemedelslistan";
        }
        var allRows = [];
        for (var x = 0; x < 2; x++) {
            allRows = drugTable.inspect({ reflectionDepth: 2 }).rows;
            if (allRows.length != 0) {
                break;
            } else {
                Wait.forSeconds(1);
            }
        }
        Log.info(logTag, "Info: lakemedellistan rows: " + allRows.length);

        var data = {};
        var rowData;
        for (var i = 0; i < allRows.length; i++) {
            var s = allRows[i];
            Log.info(logTag, JSON.stringify(s))
            if (!s["org.jdesktop.beansbinding.ObjectProperty"] || (s["org.jdesktop.beansbinding.ObjectProperty"] == "" || s["org.jdesktop.beansbinding.ObjectProperty"].slice(0, 7) == "null --") || _.includes(s["org.jdesktop.beansbinding.ObjectProperty"], ",prescriberListCategory=ACTIVE_SELF_PRESCRIBED,")) {
                continue;
            }

            rowData = s["org.jdesktop.beansbinding.ObjectProperty"];
            let med = extractDataCosmic(rowData);
            Log.info(logTag, "Info: childMedication 0"); Wait.forMilliseconds(5)
            if (_.includes(statusHandled, med.status)) {

                // FRAMTIDA
                // Run through Framtida. If a Framtida is for this ordination then Framtida added as childMedication
                for (var m = 0; m < framtida.length; m++) {
                    Log.info(logTag, "Info: loop framtida: " + m);
                    const periodsCurrent = framtida[m][framtida[m].length - 1]; // The current period from Dosering popup
                    const periodsFuture = framtida[m][framtida[m].length - 2]; // The first framtida period (there can be more)

                    // Check if Product, strength and dose match a framtida
                    Log.info(logTag, "CompareFL\n" + clearProduct(med.product) + " == " + periodsCurrent["Produkt"] + "\n" + med.strength + " == " + periodsCurrent["Styrka"] + "\n" +
                        med.dosageRaw.replace(/tv$/, "") + " == " + periodsCurrent.dosage.replace(/tv$/, ""))
                    if (clearProduct(med.product) == periodsCurrent["Produkt"] && med.strength == periodsCurrent["Styrka"] &&
                        med.dosageRaw.replace(/tv$/, "") == periodsCurrent.dosage.replace(/tv$/, "")) {

                        if (med.startDate != periodsCurrent["firstStartDate"].slice(0, 10) && med.startDate != periodsCurrent["Starttid"].slice(0, 10)) {
                            Log.error(logTag, "logError: Matching future period dates failed: >" + med.startDate + "< != >" + periodsCurrent["firstStartDate"].slice(0, 10) + "<");
                            Log.error(logTag, "logError: Matching future period dates failed: >" + med.startDate + "< != >" + periodsCurrent["Starttid"].slice(0, 10) + "<");
                        }

                        med.childMedication = periodsFuture;
                        med.hasFuturePeriod = true;
                        med.childMedication.strengthDiff = periodsFuture["Styrka"] != periodsCurrent["Styrka"];
                        Log.info(logTag, "Checkmed.exposure: " + med.exposure + " " + (med.exposure == null) + " product: " + med.product + " periodsCurrent[Sluttid]: " + periodsCurrent["Sluttid"])
                        if (med.exposure == null) {
                            med.exposure = periodsCurrent["Sluttid"].slice(0, 10);
                        }
                        med.exposureTime = periodsCurrent["Sluttid"].slice(11, 16); // Used for Sätt ut of future period

                        forskrivningarFound++;
                        // Add the future ordination to the list of ordinations for this ATC
                        periodsFuture["atc"] = med.atc;
                        periodsFuture["future"] = true;
                        periodsFuture["product"] = periodsFuture["Produkt"]
                        periodsFuture["strength"] = periodsFuture["Styrka"]
                        periodsFuture["start"] = periodsFuture["Starttid"].slice(0, 10)
                        periodsFuture["exposure"] = periodsFuture["Sluttid"]
                        periodsFuture["form"] = med.form;
                        periodsFuture["noSubstitute"] = med.noSubstitute;
                        periodsFuture["kortnotation"] = kortnotationModule.trimCosmicNotation(periodsFuture); // Add kortnotation
                        if (med.noSubstitute) {
                            periodsFuture["product"] = "Får ej bytas: " + periodsFuture["product"];
                        }
                        periodsFuture["guid"] = Guid.get();
                        // Add framtida row to data object
                        if (!Array.isArray(data[med.atc])) { // If atc key does not exist, then create it
                            data[med.atc] = [];
                        }
                        if (framtida[m].length > 2) {
                            med.manyFutureChanges = true;
                            periodsFuture.manyFutureChanges = true;
                        }

                        periodsFuture.parentCosmicData = {}; // Used to find parent ordination when updating Framtida ordination
                        periodsFuture.parentCosmicData.atc = med.atc;
                        periodsFuture.parentCosmicData.product = med.product
                        periodsFuture.parentCosmicData.strength = med.strength
                        periodsFuture.parentCosmicData.route = med.route
                        periodsFuture.parentCosmicData.form = med.form
                        periodsFuture.parentCosmicData.dosage = med.dosage
                        periodsFuture.parentCosmicData.noSubstitute = med.noSubstitute
                        periodsFuture.parentCosmicData.exposure = periodsCurrent["Sluttid"].slice(0, 10);
                        periodsFuture.parentCosmicData.exposureTime = periodsCurrent["Sluttid"].slice(11, 16);
                        periodsFuture.parentCosmicData.guid = med.guid

                        data[med.atc].push(periodsFuture); // push to atc array
                        Log.info(logTag, "One framtida match found: " + JSON.stringify(periodsFuture))
                        Log.info(logTag, "Info: med: " + JSON.stringify(med))
                        med.kortnotation = med.kortnotation.replace(/tv$/, ""); // There is a future, so the current can not be tv

                        // If current medication kortnotation does not have i3d component then add it
                        const regex = /i\d+[dv]/; // contains i3d or i10v format
                        if (!regex.test(med.kortnotation)) {
                            const slut = new Date(periodsCurrent["Sluttid"].slice(0, 10));
                            const start = new Date(periodsCurrent["Starttid"].slice(0, 10));
                            // Calculate the difference in milliseconds
                            const diffTime = Math.abs(slut - start);
                            // Convert milliseconds to days
                            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
                            med.kortnotation = med.kortnotation + "i" + diffDays + "d";
                        }
                        break;
                    }
                }

                // Add row to data object
                if (!Array.isArray(data[med.atc])) { // If atc key does not exist, then create it
                    data[med.atc] = [];
                }
                data[med.atc].push(med); // push to atc array
            }
        }

        if (forskrivningarToFind != forskrivningarFound) {
            Log.info(logTag, "Framtida found diff. forskrivningarToFind: " + forskrivningarToFind + " forskrivningarFound: " + forskrivningarFound);
            throw "Framtida förskrivningar kunde inte läsas.";
        }
        // Dialog.info("Cosmic data", "")
        // Debug.ger(data)
        return data
    } catch (e) {
        Log.error(logTag, "logerror: error reading läkemedellistan: " + (e.stack || e));
        try { Log.error(logTag, "logerror: rowData: " + rowData) } catch (e) { }
        throw "En ordination i Cosmic kunde inte läsas. Denna patient kan inte jämföras."
    }
}

// Extract data from a row in Cosmic
function extractDataCosmic(r) {
    //if (FL) Debug.ger(JSON.stringify(r))
    if (logData) Log.error(logTag, "extractDataCosmic: " + JSON.stringify(r))
    var med = {};

    var statusRegex = /,medicationTreatment\.status=(.*?),/;
    if (statusRegex.test(r)) {
        med.status = statusRegex.exec(r)[1];
    } else {
        statusRegex = /,status=(.*?),/;
        med.status = statusRegex.exec(r)[1];
    }
    Log.info(logTag, "statusHandled: " + JSON.stringify(statusHandled))
    Log.info(logTag, "Info: status = >" + med.status + "<");
    if (!_.includes(statusHandled, med.status)) {
        Log.info(logTag, "Info: Status (" + med.status + ") not handled. Medication data not retrieved");
        return med;
    }

    var productRegex = /,(unSignP|p)roductInfo=(.*?),[^ ]/;
    med.product = productRegex.exec(r)[2];
    var strengtRegex = /,(unSignS|s)trength=(.*?),\D/;
    med.strength = strengtRegex.exec(r)[2];
    var routeRegex = /,(unSignR|r)oute=(.*?),[^ ]/;
    med.route = routeRegex.exec(r)[2];
    var formRegex = /,(unSignF|f)ormText=(.*?),[^ ]/;
    med.form = formRegex.exec(r)[2];
    var atcRegex = /\.(unSignA|a)tcCode=(.*?),/;
    med.atc = "Ingen ATC-kod";
    try {
        med.atc = atcRegex.exec(r)[2];
        if (med.atc == "-") {
            med.atc = "Ingen ATC-kod";
        }
    } catch (e) {
        Log.info(logTag, "OBS: No atc code for " + med.product);
    }

    if (med.status == "PAUSED") {
        med.product = "Pausad: " + med.product;
    }

    // dosage, startDate, doseStart and exposure is found differently if it is a double period - semicolon separated ordination
    // double period regex: "Betolvidon®, 1 mg, Tablett, 10 tabletter kl 10:00 i 10 dygn  2026-03-02 10:00 - 2026-03-11 10:00; 6 tabletter kl 06:00 tills vidare  2026-03-12 06:00 - Tills vidare -- ACCORDING_TO_SCHEDULE
    var doublePeriodRegex = / (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}) - (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}); (.*?) (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}) - ((\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})|Tills vidare) -- ACCORDING_TO_SCHEDULE/;
    let doublePeriod = doublePeriodRegex.test(r);
    med.exposure = null;
    if (doublePeriod) {
        Log.info(logTag, "doublePeriod")
        // Double period
        let doubleData = doublePeriodRegex.exec(r);
        let p1endDate = doubleData[3]; // end date of first period
        let p1endTime = doubleData[4]; // end time of first period
        // If end date+time is later than "now" then use first period date and time and dosageText1
        if (new Date(p1endDate + " " + p1endTime).getTime() - Date.now() > 0) {
            med.startDate = doubleData[1]; // start date of first period
            med.exposure = p1endDate; // End date of first period
            let dosageRegex = /,(unSignD|d)osageText1=(.*?),[^ \d]/;
            med.dosage = dosageRegex.exec(r)[2];
        } else {
            // Use second period date and time and dosageText2
            med.startDate = doubleData[6]; // start date of second period
            let p2endDate = doubleData[8]; // end date of second period. Can be "Tills vidare"
            med.exposure = p2endDate == "Tills vidare" ? null : p2endDate;
            let dosageRegex = /,(unSignD|d)osageText2=(.*?),[^ \d]/;
            med.dosage = dosageRegex.exec(r)[2];
        }
        Log.info(logTag, "medCheck " + JSON.stringify(med))
    } else {
        // Single period

        // Start date
        try {
            med.startDate = false;
            let startDateRegex;
            if (_.includes(r, "Behandlingsstart: ")) {
                startDateRegex = /Behandlingsstart: (\d{4}-\d{2}-\d{2}) /;
            } else {
                if (_.includes(r, "Ursprunglig tid: ")) {
                    startDateRegex = /Ursprunglig tid: (\d{4}-\d{2}-\d{2}) /;
                }
            }
            if (startDateRegex) {
                med.startDate = startDateRegex.exec(r)[1];
                let sd = new Date(med.startDate)
                med.future = (sd.getTime() - Date.now()) > 0;
            }
        } catch (e) { }

        // DoseStart
        try {
            med.doseStart = false;
            var doseDateRegex = /=Doseringstid: (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}) - /;
            med.doseStart = doseDateRegex.exec(r)[1];
            med.doseTid = doseDateRegex.exec(r)[2];
        } catch (e) { }

        // Exposure
        // expRegex: if exposure the format is "- 2026-01-06 13:00 --". Else it is tv w. format "- Tills vidare --"
        var expRegex = /- (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}) --/;
        if (expRegex.test(r)) {
            med.exposure = expRegex.exec(r)[1]
        } else {
            med.exposure = null;
        }

        // Dosage
        var dosageRegex = /,(unSignD|d)osageText1=(.*?),[^ \d]/;
        med.dosage = dosageRegex.exec(r)[2];

        // TODO shold the below code with tv and max still be included?
        if (_.includes(med.dosage, "tv, max")) {
            med.dosage = med.dosage.replace("tv, max", " max") + "tv";
        }
        med.dosage = med.dosage.replace(", max", " max");
    }

    // Map max dosage text
    med.dosageRaw = med.dosage
    if (_.includes(med.dosage, "tv, max")) {
        med.dosage = med.dosage.replace("tv, max", " max") + "tv";
    }
    med.dosage = med.dosage.replace(", max", " max");

    Log.info(logTag, "FLLOG Cosmic exposure 2 " + med.exposure + " " + med.product)
    // Ej utbytbar 
    //,latestSignedOrVerbal.noSubstitution=false,
    var substituteRegex = /latestSignedOrVerbal.noSubstitution=(.*?),/;
    try {
        if (_.includes(r, "latestSignedOrVerbal.noSubstitution=")) {
            med.noSubstitute = substituteRegex.exec(r)[1] == "true";
            if (med.noSubstitute) {
                med.product = "Får ej bytas: " + med.product;
            }
        }
    } catch (e) {
        Log.info(logTag, "logError: noSubstitute error: " + e)
        med.noSubstitute = false;
    }
    // Set kortnotation and form properties
    med.kortnotation = kortnotationModule.trimCosmicNotation(med);
    med.formAlt = kortnotationModule.trimForm(med.form);
    Log.info(logTag, "Cosmic med.kortnotation: " + med.kortnotation)
    med.guid = Guid.get();

    return med;
}
exports.extractDataCosmic = extractDataCosmic;

//======================================================================== READ PASCAL DATA ========================================================================

// ==== Pascal entry ====

function _dynamicPascalApp() {
    Log.info(logTag, "Info: _dynamicPascalApp");
    dynamicPascal = new Application({
        urlContains: "eordination|siths.se",
        type: ApplicationTypes.EDGE
    }, { noLaunch: true });
    dynamicPascal.attach();
}

// Pascal entry with dynamic app
function _handlePascalEntryDynamicApp(pid) {
    Log.info(logTag, "Info: _handlePascalEntryDynamicApp");
    _dynamicPascalApp();

    let daniella = new Field("**/choose-user/**/Daniella Jats", dynamicPascal);
    let laddar = new Field("**/Laddar...", dynamicPascal);
    let goBack = new Field("**/Gå tillba*", dynamicPascal);
    let bekraftaOchFortsatt = new Field("**/Bekräfta *", dynamicPascal);
    let tableWrapper = new Field("**/tableWrapper", dynamicPascal)
    const komError = new Field("**/global-error-dialog/**/Ett fel uppstod i kommunikatio*");
    let pidField = new Field("(aurelia-app)main/**/(class)section1-flex/(class)au-target/**/(class)pin/(text)" + pid, dynamicPascal);
    let pidClicked = false;

    for (let i = 0; i < 90; i++) {

        if (laddar.exists()) {
            try {
                Log.info(logTag, "Waiting for Laddar")
                if (onlyEntry) { // If data is not to be read from Pascal.
                    return;
                }
                Wait.forFieldToDisappear(laddar, 1);
            } catch (e) { }
        }
        if (goBack.exists()) {
            goBack.click();
        }
        if (bekraftaOchFortsatt.exists()) {
            bekraftaOchFortsatt.click();
        }


        const testUsers = ["fne122", "thomas"];
        if (_.includes(testUsers, Env.userName)) {
            if (_.includes(dynamicPascal.location(), "siths.se")) {
                dynamicPascal.navigate("https://testidp.eordinationpascal.se/?SAMLRequest=hJFLb8IwEITvSPwHy3eIyYOHRSJF5YJEL9D20JvjLMVSYqfedcXPb4CgtlLVXmf3m9nRrlG1TdzJMtDJ7uE9ABI7t41FeZvkPHgrnUKD0qoWUJKWh%2FJxJ%2BOpkJ135LRr%2BHfmb0QhgifjLGfbTc5NvZxViyxJV7FYHtMYdHVMktVML1diPl%2BoOuPsBTz2QM57vqcQA2wtkrLUSyKeT0Q6mSVPIpVZJrPklbNNX8NYdYnJ%2BYmoQxlFdBHrbgrO18OwU6hVM0WIOCvvhz04i6EFfwD%2FYTQ873dfHoGq3%2Flr86jU2BsReVMFgpuRsW%2BD09bWcM654MV4xNj6ishrHV%2F8F7C%2BJdzXx6NB%2BPm64hMAAP%2F%2FAwA%3D&RelayState=kqeQ1uVHSIwkddA0jedA6Jdb#/patient/lakemedel");
                Wait.forSeconds(3);
            }

            if (pidField.exists() && !pidClicked) {
                pidClicked = true;
                Wait.forSeconds(1)
                pidField.click();
            }
        }

        if (daniella.exists()) {
            daniella.click();
        }

        if (tableWrapper.exists()) {
            Log.info(logTag, "tableWrapper exists")
            break;
        }

        if (komError.exists()) {
            throw "Fel i kommunikation med Pascal";
        }

        Log.info(logTag, "handlePascalEntry loop: " + i);
        Wait.forMilliseconds(444);
    }
}

function handlePascalEntryDynamicApp(pid) {
    Log.info(logTag, "Info: handlePascalEntryDynamicApp");
    for (let x = 0; x < 20; x++) {
        try {
            _handlePascalEntryDynamicApp(pid);
            break;
        } catch (e) {
            Wait.forMilliseconds(999)
            Notification.show("WaitingPascal", "Väntar på Pascal", "", { timeout: 1 })
        }
    }
}

//===== Get pascal data functions ====

exports.getPascalData = function (pid) {
    Log.info(logTag, "Info: getPascalData in module");
    // NOTE: Tables must be expanded before reading the data
    try {
        if (pascalApp == "dynamic") {
            handlePascalEntryDynamicApp(pid);
        } else {
            handlePascalEntry(Inputs["onlyEntry"], pid);
        }

        if (Inputs["onlyEntry"] == "True") {
            return;
        }

        expandTables();
        var data = _readPascalData(true) // Read data. Include Recept Dosering from tab (true)
        if (logData) Log.info(logTag, "Info: Pascal readData data: " + JSON.stringify(data))
        if (!data) {
            data = {};
        }
        let res = convertChildMedication(data);
        Log.info(logTag, "Info: get data res: " + JSON.stringify(res.data))
        data = res.data;
        verifyRowCounts(data, res.futureCount); // Validate that correct number of rows were read
        closeExpandedTables();
        data = adjustDosageAndForm(data) // Convert dosage and form to match Cosmic formats
        return data // Stringify to be able to send as output
    } catch (e) {
        Log.error(logTag, "logError: failed to get Pascal data in Pascal get data: " + (e.stack || e))
        throw typeof e == "string" ? e : "Fel vid läsning av Pascal";
    }
}

/**
 * Groups drug-row-group elements into { [ATC-kod]: Medication[] }.
 * Shared so readPascalData and getPascalHistoricReceptChange return the same shape.
 * @param options.includeHistoric  readPascalData passes false; historic reads pass true
 */
function _groupDrugRowGroups(elements, options) {
    const historicOnly = options && options.includeHistoric === true;

    return _.reduce(elements, (acc, curr) => {
        const isExpanded = curr.querySelectorAll('.expanded').length > 0;
        if (!isExpanded) return acc;

        const isHistoric = _isHistoricData(curr);

        if (isHistoric && !historicOnly) return acc;
        if (!isHistoric && historicOnly) return acc;

        const fields = curr.querySelectorAll('.transparentBox');
        const prescriptionStateIcons = curr.querySelectorAll('static-state-icons span.vb');

        const kod = _getDataByTitle(fields, 'ATC-kod');
        const data = _getMedicationData(fields, curr);
        if (!data.product || data.product === "") data.product = _getDrugName(curr);

        data['guid'] = Guid.get();
        data['hasVb'] = prescriptionStateIcons.length > 0;

        const childProducts = curr.querySelectorAll('[as-element="drug-row"]');
        data['childMedication'] = childProducts.length > 1 ? _getChildMedicationData(_.last(childProducts)) : null;

        if (data.childMedication != null) {
            // Populate child with general parent data
            data.childMedication.noSubstitute = data.noSubstitute;
            data.childMedication.forsk = data.forsk;
            data.childMedication.textToPatient = data.textToPatient;
            data.childMedication.doseUnit = data.doseUnit;
            data.childMedication.prescriber = data.prescriber;
            data.childMedication.workplace = data.workplace;
        }

        if (data.insertion && !kod) {
            if (data.form === "") data.form = "Ospecificerad";
            (acc['Ingen ATC-kod'] || (acc['Ingen ATC-kod'] = [])).push(data);
            return acc;
        }
        if (kod) {
            (acc[kod] || (acc[kod] = [])).push(data);
        }
        return acc;
    }, {});
}

exports.getHistoricPrescriptionChanges = function () {
    // Checks whether the 'Utsättnings-/makuleringsorsak' column (td 9) of a historic row
    // contains the given reason. Works on a loaded Html document or a drug-row-group element.
    const hasCancellationReason = (node, reason) => {
        const cell = node.querySelectorAll('td:nth-child(9)')[0];
        const text = _.toLower(_.trim(cell?.innerText ?? ''));
        return _.includes(text, _.toLower(reason));
    }

    _expandHistoricTable();

    const now = new Date();
    const today = `${now.getFullYear()}-${_.padStart((now.getMonth() + 1).toString(), 2, '0')}-${_.padStart(now.getDate().toString(), 2, '0')}`;
    const receptChangedIconPath = { byPath: `**/[tbody]/**/${today}` };
    const cancellationReason = 'Avslutad';

    const isAvslutadField = field => {
        try {
            const html = field?.inspect({ includeChildren: false })['html'];
            return !!html && hasCancellationReason(Html.load(html), cancellationReason);
        } catch (e) {
            Log.warn(logTag, "getHistoricPrescriptionChanges: could not inspect row: " + e);
            return false;
        }
    };

    // Click 'Recept & dosering' only for today's historic rows where the reason is 'Avslutad'.
    // The historic table must be expanded for below to work
    new Field('**/pl-table au-target', dynamicPascal)
        .findAll(receptChangedIconPath)
        .filter(isAvslutadField)
        .forEach(field => {
            const prescriptAndDosageBtn = field.find('Recept & dosering');

            if (prescriptAndDosageBtn?.exists()) {
                prescriptAndDosageBtn.click();
                Wait.forSeconds(3) // wait for prescription data
            }
        });

    // Re-find after clicking, since the DOM has changed
    const htmlRows = new Field('**/pl-table au-target', dynamicPascal)
        .findAll(receptChangedIconPath)
        .map(field => field?.inspect({ includeChildren: false })['html'])
        .join('');

    const elements = _.filter(
        Html.load(htmlRows).querySelectorAll('[as-element="drug-row-group"]'),
        el => hasCancellationReason(el, cancellationReason)
    );

    closeExpandedTables();

    return _groupDrugRowGroups(elements, { includeHistoric: true });
};

// Set kortnotation and altForm properties for each medication
// Input is the whole object with all atccodes and underlying prescriptions
// The function is called recursively for each prescription
function adjustDosageAndForm(obj) {
    if (typeof obj !== 'object' || obj === null) return;
    for (const key in obj) {
        if (!obj.hasOwnProperty(key)) continue;
        if (typeof obj[key] === 'object') {
            // recursive call for prescription object
            adjustDosageAndForm(obj[key]);
        } else {
            // In a prescription object find dosage and form
            if (key === 'dosage' && typeof obj[key] === 'string') {
                Wait.forMilliseconds(2); // Only to separate log statements for each key
                // Set kortnotation
                if (obj['dosage'] == "" && !_.includes(obj['textToPatient'], ".")) {
                    obj['dosage'] = obj['textToPatient'];
                }
                var dosageTrimmed = kortnotationModule.trimNotation(obj['dosage']);
                Log.info(logTag, "Info: dosageTrimmed: " + dosageTrimmed);
                try {
                    if (normText(!_.includes(obj["doseUnit"], "Doseringsenhet:"))) {
                        obj["kortnotation"] = "eo" + (!!obj["hasVb"] ? "vb" : "");
                    } else {
                        obj["kortnotation"] = kortnotationModule.klartextToKortnotation(dosageTrimmed);
                    }
                    if (obj["kortnotation"] != "Okänd" && obj["kortnotation"] != "eo") {
                        // For this object (prescription) find exposure value and set tv if no exposure date is found
                        for (const key2 in obj) {
                            if (key2 === 'exposure') {
                                if (obj['exposure'] == "null" || obj['exposure'] == null || obj['exposure'] == "") {
                                    if (!obj["kortnotation"].trim().endsWith("tv") && !_.includes(obj["kortnotation"], "engångsdos") && !obj["kortnotation"].trim().endsWith("end") && !_.includes(obj["kortnotation"], "maxTillsVidare")) {
                                        obj["kortnotation"] += "tv";
                                    }
                                    obj['exposure'] = null;
                                } else {
                                    if (obj["kortnotation"].trim().endsWith("tv")) {
                                        Log.info(logTag, "logError: kortnotation with exposure date had tv: " + obj["kortnotation"]);
                                        obj["kortnotation"] = _.trim(obj["kortnotation"]).slice(0, -2);
                                    }
                                }
                            }
                        }
                    }
                    // Check if vb is correct. Insert or removed depending on property hasVb
                    if (obj["kortnotation"] != "Okänd") {
                        Log.info(logTag, "hasVb: " + obj["hasVb"] + " " + (obj["hasVb"] === true) + " " + (obj["hasVb"] === false) + " " + obj['product'])
                        if (_.includes(obj["kortnotation"], "vb") && obj["hasVb"] !== true && obj["hasVb"] !== undefined) {
                            Log.info(logTag, "OBS: VB was removed " + obj["hasVb"] + " " + obj["kortnotation"] + " before removal of vb")
                            obj["kortnotation"].replace("vb", "");
                        }
                        if (!_.includes(obj["kortnotation"], "vb") && obj["hasVb"] === true) {
                            Log.info(logTag, "OBS: VB was added " + obj["hasVb"] + " " + obj["kortnotation"] + " before adding vb")
                            obj["kortnotation"] = obj["kortnotation"] + "vb";
                        }
                    }
                } catch (e) {
                    obj["kortnotation"] = "Okänd"
                    try { if (logData) Log.warn(logTag, "logError: adjustDosageAndForm error: obj: " + JSON.stringify(obj)); } catch (e) { }
                    Log.warn(logTag, "logError: adjustDosageAndForm error: " + e);
                }
                Log.info(logTag, "Pascal kortnotation: " + obj["kortnotation"]);
            }
            if (key === 'form' && typeof obj[key] === 'string') {
                obj["formAlt"] = kortnotationModule.trimForm(obj['form']);
            }
        }
    }
    if (obj["dosage"]) {
        obj["dosage"] = mapSwedish(obj["dosage"])
    }
    return obj;
}

// Expand tables in Pascal
function expandTables() {
    Log.info(logTag, "Info: expandTables");
    try {
        expandRecursively()
    } catch (e) {
        Wait.forSeconds(1);
        expandRecursively()
    }
}

// Close the expanded tables
function closeExpandedTables() {
    Log.info(logTag, "Info: closeExpandedTables");

    const isSectionExpanded = (rows) => _.some(rows, row => row.querySelectorAll('.expanded').length > 0);

    try {
        const { future, current, historic } = _getMedicationDrugRowsCategorized();

        const sections = [
            { name: 'Framtida', expanded: isSectionExpanded(future) },
            { name: 'Aktuella', expanded: isSectionExpanded(current) },
            { name: 'Historiska', expanded: isSectionExpanded(historic) },
        ];

        sections.forEach(section => {
            if (!section.expanded) return;

            const toggleBtn = new Field(`**/section-header/**/*${section.name}*<above>fa fa-expand expandAction`, dynamicPascal);
            if (toggleBtn.exists()) {
                Log.info(logTag, "Info: closing " + section.name);
                toggleBtn.click();
                Wait.forMilliseconds(200);
            }
        });

        Mouse.scroll(35); // Scroll to top
    } catch (e) {
        // Don't fail the flow if closing the tables fails
        Log.info(logTag, "logError: closeExpandedTables failed: " + e);
    }
}


// ==== These functions reads in html ====

/**
 * Returns the total medication count the Robot has read.
 */
function _getTotalReadMedication(obj) {
    Log.info(logTag, "Info: getTotalReadMedication");
    return _.reduce(obj, (acc, curr) => acc + curr.length, 0);
}

exports.getTotalReadMedication = function (obj) {
    Log.info(logTag, "Info: getTotalReadMedication");
    return _getTotalReadMedication(obj)
}

function _readPascalData(includeReceptDosering) {
    Log.info(logTag, "Info: readData");
    const html = includeReceptDosering === true
        ? _ensurePrescriptionDataLoaded()
        : _getHtml();

    return _groupDrugRowGroups(html.querySelectorAll('[as-element="drug-row-group"]'), { includeHistoric: false });
}
/**
 * Clicks on every 'Recept & dosering' tab, which loads data inside this tab.
 * 
 * @returns the updated html 
 */
function _ensurePrescriptionDataLoaded() {
    Log.info(logTag, "Info: _ensurePrescriptionDataLoaded");
    const expandedCount = _getExpandedCount();
    const dataToWaitFor = [];

    for (let i = 0; i < expandedCount; i++) {
        const textToPatientField = pascalApp == "dynamic" ? new Field(`**/*section-body au-target#${i}/**/Text till patient`, dynamicPascal) : new Field(`**/*section-body au-target#${i}/**/Text till patient`);
        const prescriptAndDosageBtn = pascalApp == "dynamic" ? new Field(`**/*section-body au-target#${i}/**/Recept & dosering`, dynamicPascal) : new Field(`**/*section-body au-target#${i}/**/Recept & dosering`);

        if (textToPatientField.exists()) continue;

        if (prescriptAndDosageBtn.exists()) {
            prescriptAndDosageBtn.click();
            dataToWaitFor.push(textToPatientField);
        }
    }

    for (const dataField of dataToWaitFor) {
        try {
            Wait.forField(dataField, 30);
        } catch (e) { }
    }
    return _getHtml();
}

/**
 * Expands the medications blocks with headers 'Fremtida' and 'Aktuella' recursively. 
 * Max 5 retries.
 */
function expandRecursively(retries = 0) {
    Log.info(logTag, "Info: expandRecursively");
    const prevExpandedCount = _getExpandedCount()
    const totalLakemdelCount = getTotalMedicationCount()

    // base case
    if (retries > 5 || prevExpandedCount === totalLakemdelCount) return

    if (prevExpandedCount !== totalLakemdelCount) {
        const futureExpandBtn = new Field("**/section-header/**/*Framtida*<above>fa fa-expand expandAction", dynamicPascal);
        const aktuellaExpandBtn = new Field("**/section-header/**/*Aktuella*<above>fa fa-expand expandAction", dynamicPascal);

        [futureExpandBtn, aktuellaExpandBtn].forEach(btn => {
            if (btn.exists()) {
                btn.click();
            }
        });
    }

    expandRecursively(++retries)
}

function _expandHistoricTable() {
    const historicExpandbtn = new Field('**/section-header/**/*Historiska*<above>fa fa-expand expandAction', dynamicPascal);
    if (!historicExpandbtn.exists()) return;

    const countText = new Field("**/section-header/**/*Historiska*", dynamicPascal).read()["text"];
    const targetCount = _extractCount(countText)

    for (let attempt = 0; attempt <= 5; attempt++) {
        const expandedCount = _getExpandedHistoricCount(_getHtml());
        if (expandedCount === targetCount) return;

        historicExpandbtn.click();
        Wait.forMilliseconds(200);
    }

    Log.warn(logTag, `_expandHistoricTable: gave up, expanded count never reached ${targetCount}`);
}

/**
 * Returns the inner HTML from Pascal Läkemdel wrapper.
 */
function _getHtml() {
    Log.info(logTag, "Info: _getHtml.");
    const tableWrapper = new Field("**/tableWrapper", dynamicPascal);
    try { Log.info(logTag, "Info: dynamicPascal " + JSON.stringify(dynamicPascal)); } catch (e) { }

    if (!tableWrapper.exists()) {
        Wait.forSeconds(3);
        if (!tableWrapper.exists()) {
            throw Error('Kunde inte läsa DOM information i Pascal.');
        }
    }

    let res;

    try {
        res = tableWrapper.inspect({ includeChildren: false });
    } catch (e) {
        Wait.forSeconds(3);
        Log.info(logTag, "Info: redo tableWrapper inspected");
        res = tableWrapper.inspect();
    }
    Log.info(logTag, "Info: tableWrapper inspected");
    const html = Html.load(res.html);
    Log.info(logTag, "Info: html loaded.");

    return html;
}

/**
 * Returns the total count of expanded medications.
 */
function _getExpandedCount() {
    Log.info(logTag, "Info: _getExpandedCount");
    const html = _getHtml();
    const historicDataCount = _getExpandedHistoricCount(html);

    return html.querySelectorAll(".au-target.pl-row-details.expanded").length - historicDataCount;
}

/**
 * Returns the total medication count read from the medication tab, at Läkemedel (X).
 */
function getTotalMedicationCount() {
    Log.info(logTag, "Info: getTotalMedicationCount");
    const lakemdelCountField = pascalApp == "dynamic" ? new Field('**/tabContainer/**/count', dynamicPascal) : new Field('**/tabContainer/**/count');
    if (!lakemdelCountField.exists()) {
        throw Error('Kunde inte hitta fältet som innehåller läkemedelsantalet.');
    }

    const countStr = lakemdelCountField.read()['text'];
    const count = _extractCount(countStr);
    if (!count) {
        throw Error(`Det gick inte att extrahera ett numeriskt värde från texten för läkemedelsantal: "${countStr}"`);
    }

    if (isNaN(count)) {
        throw Error(`Det analyserade antalet läkemedel är inte ett giltigt nummer: "${countStr}"`);
    }

    return count;
}
exports.getTotalMedicationCount = getTotalMedicationCount;

/**
 * @property {string} guid - Unique identifier
 * @property {string} product - Läkemedelsnamn
 * @property {string} strength - Styrka
 * @property {string} form - Läkemedelsform
 * @property {string|null} dosage - Dosering
 * @property {string} treatmentReason - Behandlingsorsak
 * @property {string} insertion - Insättning
 * @property {string} exposure - Utsättning
 * @property {string} noSubstitute - Får bytas
 * @property {string} forsk - Förskrivningstidpunkt
 * @property {string} textToPatient - Text till patient
 * @property {string} doseUnit - Doseringsenhet
 * @property {string} prescriber - Förskrivare
 * @property {Array} workplace - Arbetsplats
 * @property {MedicationData|null} childMedication - Child medication data
 */
function _createMedicationData(overrides) {
    const defaults = {
        guid: Guid.get(),
        product: '',
        strength: '',
        form: '',
        dosage: null,
        treatmentReason: '',
        insertion: '',
        exposure: '',
        noSubstitute: '',
        forsk: '',
        textToPatient: '',
        doseUnit: '',
        prescriber: '',
        workplace: [],
        childMedication: null,
    };

    return _.assign({}, defaults, overrides);
}

function mapSwedish(s) {
    if (!s) {
        return s;
    }
    return s.replace(/&#228;/g, "ä").replace(/&#246;/g, "ö").replace(/&#229;/g, "å").replace(/&gt;/g, ">");
}
exports.mapSwedish = mapSwedish;

function _getMedicationData(fields, curr) {
    let medInfo = _createMedicationData({
        product: _getDataByTitle(fields, 'Läkemedelsnamn'),
        strength: _getDataByTitle(fields, 'Styrka'),
        form: _getDataByTitle(fields, 'Läkemedelsform'),
        dosage: _getDosage(curr.querySelectorAll('.dosageStructureWrap')),
        treatmentReason: _getDataByTitle(fields, 'Behandlingsorsak') ?? _getTreatmentReason(curr.querySelectorAll('.wrap')),
        insertion: _getDataByTitle(fields, 'Insättning').replace("(", "").replace(")", ""),
        exposure: _getDataByTitle(fields, 'Utsättning'),
        noSubstitute: _getDataByTitle(fields, 'Får bytas') != "Ja",
        forsk: _getDataByTitle(fields, 'Förskrivningstidpunkt'),
        textToPatient: mapSwedish(_getDataByTitle(fields, 'Text till patient')),
        doseUnit: _getDosageUnit(curr.querySelectorAll('.dosageUnitDisplay > div')),
        prescriber: _getDataArrByTitle(fields, 'Förskrivare').join(' '),
        workplace: _getDataArrByTitle(fields, 'Arbetsplats'),
    });
    if (medInfo.noSubstitute) {
        medInfo.product = "Får ej bytas: " + medInfo.product;
    }
    medInfo.dosage = mapSwedish(medInfo.dosage);
    Log.info(logTag, "Pascal dosage: " + medInfo.dosage);
    // Set future if insertion is later than today
    const d = new Date();
    const today = d.getFullYear() + '-' +
        _.padStart(_.toString(d.getMonth() + 1), 2, '0') + '-' +
        _.padStart(_.toString(d.getDate()), 2, '0');
    if (new Date(today) < new Date(medInfo.insertion)) {
        medInfo.future = true;
    }

    // Find trailing text in textToPatient. To be inserted in “Notera vid administrering” 
    const separatorTexts = _.map(kortnotationModule.trailingArray, function (s) { return ". " + s.toLowerCase() + "."; });
    const firstMatch = separatorTexts.find(text => medInfo.textToPatient.toLowerCase().includes(text));
    if (!firstMatch) {
        if (logData) Log.info(logTag, "Info: noteAdmin !firstMatch");
        medInfo.noteAdmin = false; // Return false if no match is found
    } else {
        // Get the index of the matched text
        const matchIndex = medInfo.textToPatient.toLowerCase().indexOf(firstMatch);
        if (logData) Log.info(logTag, "Info: noteAdmin matchIndex: " + matchIndex);
        medInfo.noteAdmin = medInfo.textToPatient.slice(matchIndex + firstMatch.length);
        if (logData) Log.info(logTag, "Info: noteAdmin medInfo.noteAdmin: " + medInfo.noteAdmin);
    }
    return medInfo;
}

function _getChildMedicationData(element) {
    if (!element) return null;

    const tds = element.querySelectorAll('td');
    const { strength, form } = _getStrengthAndForm(element);

    return _createMedicationData({
        product: _.trim(element.querySelector('.tradename .inlineBlock:not(.check)')?.innerText ?? ''),
        strength: strength,
        form: form,
        dosage: _getDosage(element.querySelectorAll('.dosageStructureWrap')),
        treatmentReason: tds[8].innerText,
        insertion: _.trim(element.querySelector('.startDateWrapper')?.innerText ?? ''),
        exposure: _.trim(element.querySelector('.changeEndingWrapper')?.innerText ?? ''),
    });
}

/*
2 types of future periods:
1) Dose with "Därefter"
2) Double-row (ChildMedications)
*/
function convertChildMedication(data) {
    Log.info(logTag, "convertChildMedication: " + JSON.stringify(data))
    let newData = {};
    let futureCount = 0;
    _.forIn(data, function (medArray, atc) {
        newData[atc] = [];
        _.forEach(medArray, function (med) {
            // Type 1) Därefter
            // Remove trailing sentence with the word "därefter" if "därefter is not followed by a digit, which show that it is a new dose string"
            //1 tablett kl 08 varje måndag, 1 tablett kl 08 varje onsdag, 2 tabletter kl 08 varje torsdag, 1 tablett kl 08 varje lördag. Upprepa därefter schema
            var trunkatedDose = kortnotationModule.trimNotation(med.dosage.toLowerCase()).replace(/\s*[^.!?]*(därefter(?!\s\d))[^.!?]*([.!?]|$)/, '');
            if (_.includes(trunkatedDose, "därefter ")) {
                Log.info(logTag, "därefter i dosage: " + med.dosage);
                var splitDosage = trunkatedDose.split("därefter");
                med.dosage = splitDosage[0].trim().replace(/$\./, "") + ". Har framtida dos.";
                med.manyFutureChanges = splitDosage.length > 2;
                if (splitDosage.length > 2) { // If there are more than one future period then eo and not future periods derived
                    Log.info(logTag, "manyFutureChanges = true: " + med.dosage);
                    newData[atc].manyFutureChanges = true; // TODO Change to handle more future periods
                    newData[atc].push(med);
                } else {
                    // Only two periods handled
                    // Period 2
                    let futureMed = { ...med };

                    // Find enddate of period 1 (current period)
                    // If current period can not be parsed then do not set values for:
                    // endDate of current, and startDate of future
                    let iRegex = /i (\d{1,2}) (dygn|dagar|veckor)/;
                    if (!splitDosage[0].match(iRegex)) {
                        Log.info(logTag, "Därefter wrong format: " + splitDosage[0])
                    } else {
                        var count = Number(iRegex.exec(splitDosage[0])[1]);
                        if (iRegex.exec(splitDosage[0])[2] == "veckor") {
                            count = count * 7;
                        }
                        // Find end date / expiry date of current ordination
                        let d1 = new Date(med.insertion);
                        d1.setDate(d1.getDate() + count - 1); // Minus 1 because the start day and end day both count in the number of days
                        let currentExposure = d1.getFullYear() + "-" + _.padStart((Number(d1.getMonth()) + 1).toString(), 2, "0") + "-" + _.padStart(d1.getDate().toString(), 2, "0")
                        // Find start date of future ordination
                        let d = new Date(med.insertion);
                        d.setDate(d.getDate() + count);
                        let startDate = d.getFullYear() + "-" + _.padStart((Number(d.getMonth()) + 1).toString(), 2, "0") + "-" + _.padStart(d.getDate().toString(), 2, "0")

                        futureMed.insertion = startDate; // Set start date of future
                        med.exposure = currentExposure; // Set the exposure date for the current period
                    }

                    futureMed.guid = Guid.get();
                    futureMed.future = true;
                    futureMed.dosage = splitDosage[1].replace("därefter ", "");
                    futureMed.currentPeriodGuid = med.guid; // Used to find the current period
                    futureMed.atc = atc;
                    med.childMedication = futureMed;
                    newData[atc].push(med); // Push current period med
                    newData[atc].push(futureMed); // Push framtida period med
                    futureCount++;
                }

            } else {
                // Type 2: Double-row
                newData[atc].push(med); // Push unchanged
                if (med.childMedication) {
                    Log.info(logTag, "Type 2: Double-row childMedication");
                    // Dialog.info("child",JSON.stringify(med, null, 2) + "\n\n" +JSON.stringify(med.childMedication, null, 2))
                    med.childMedication.future = true;
                    med.childMedication.atc = atc;
                    med.childMedication.currentPeriodGuid = med.guid;  // Used to find the current period
                    newData[atc].push(med.childMedication);
                    futureCount++;
                }
            }
        });
    });
    return { data: newData, futureCount: futureCount };
}


/**
 * Extracts a single text value from a <p> tag within a parent element that contains a specific title.
 * 
 * Similar to _getDataArrByTitle, but returns only the first <p> element's text content as a string.
 * Used for medication fields that have a single value.
 * 
 * Examples: "Styrka" (Strength), "Läkemedelsnamn" (Product)
 * 
 * @returns {string} Text content from the first child <p> tag, or empty string if not found
 */
function _getDataByTitle(selectors, title) {
    //Log.info(logTag, "Info: _getDataByTitle");
    const parent = _.find(selectors, (obj) => obj.innerText && _.includes(_.trim(obj.innerText), title));

    if (parent) {
        const paragraph = parent.querySelector('p');
        return paragraph?.innerText ?? "";
    }

    return "";
}

/**
 * Returns the 'Dosering' from a medication. If not found, return. null.
 * Eg. '1 tablett kl 08. Sväljes.'
 */
function _getDosage(selectors) {
    const dos = selectors[0]

    if (!dos) return null
    if (!dos["attrs"]) return null
    return mapSwedish(dos["attrs"]["data-popover"]) ?? null
}

/**
 * Returns the 'Behandlingsorsak' from a medication. If not found, returns null.
 * 
 * Eg. 'Folsyrabrist orsakad av läkemedelsbehandling'
 */
function _getTreatmentReason(selectors) {
    const behan = selectors[6];

    if (!behan) return null;

    return behan['innerText'] ?? null;
}

function _getDosageUnit(selectors) {
    const dosageUnit = selectors[0];

    if (!dosageUnit) return '';

    return dosageUnit['innerText'] ?? null;
}

function _getDrugName(curr) {
    try {
        return curr.children[0].children[2].children[0].children[1].innerText
    } catch (e) {
        return "Läkemedelnamn kunde inte läsas";
    }
}

/**
 * Find the td element where colspan.bind contains 'isCombinedStrengthAndForm'
 */
function _getStrengthAndForm(element) {
    const tds = element.querySelectorAll('td');

    for (let i = 0; i < tds.length; i++) {
        const td = tds[i];

        if (!td["attrs"]) continue;

        const colspanBind = td["attrs"]["colspan.bind"];
        if (colspanBind && _.includes(colspanBind, 'isCombinedStrengthAndForm')) {
            const strengthWrap = td.querySelector('.wrap');
            const strength = _.trim(strengthWrap?.innerText ?? '');

            // Form is in the next td element
            const nextTd = tds[i + 1];
            const formWrap = nextTd ? nextTd.querySelector('.wrap') : null;
            const form = _.trim(formWrap?.innerText ?? '');

            return {
                strength: strength,
                form: form
            };
        }
    }

    return {
        strength: '',
        form: ''
    };
}
/**
 * Determine if data is historical by checking for 'Utsatt', 'Makulerad', 'Utgången' or 'Avslutad' status
 * These statuses only appear in 'Historiska' data, and SHOULD not appear in 'Fremtida' or 'Aktuella' data
 * NOTE: There might be edge cases where NONE of these exists! 
 */
function _getExpandedHistoricCount(html) {
    return _.filter(html.querySelectorAll('div.transparentBox span.smallTitle'), (curr) => {
        const innerText = _.trim(_.toLower(curr['innerText']));
        return (innerText === 'utsatt') || (innerText === 'makulerad') || (innerText === 'utgången') || (innerText === 'avslutad') || (innerText === 'slutexpedierad');
    }).length
}

/**
 * Determines if a medication entry is under the header 'Historiska'.
 * 
 * Historical medications are identified by checking for specific status labels
 * in the expanded medication details. A medication is considered historical if
 * it has one of the following statuses:
 * - "utsatt" (discontinued)
 * - "makulerad" (cancelled)
 * - "utgången" (expired)
 * - "avslutad" (completed)
 * - "slutexpedierad" (completed)
 * 
 * @param curr - The DOM element representing a medication row
 * @returns True if the medication is historical, else false
 * 
 * @remarks
 * This function requires the medication row to be expanded in the UI.
 * If the row is collapsed, the status labels won't be present in the DOM
 * and the function will return false even for historical medications.
 */
function _isHistoricData(curr) {
    const selectors = curr.querySelectorAll('div.transparentBox span.smallTitle');
    const hasData = val => !!_.find(selectors, (obj) => obj['innerText'] && _.trim(_.toLower(obj['innerText'])) === val);

    return hasData('utsatt') || hasData('makulerad') || hasData('utgången') || hasData('avslutad') || hasData('slutexpedierad');
}

/**
 * Extracts text content from <p> tags within a parent element that contains a specific title.
 * 
 * In medication data, information is sometimes distributed across different divs.
 * This function finds the parent element containing the specified title text,
 * then extracts all text from its child <p> elements.
 * 
 * Example use cases: Extracting "Förskrivare" (Prescriber) or "Arbetsplats" (Workplace) data
 * 
 * @returns {Array<string>} Array of text content from child <p> tags, or empty array if not found
 */
function _getDataArrByTitle(selectros, title) {
    const parent = _.find(selectros, (obj) => obj.innerText && _.includes(_.trim(obj.innerText), title));

    if (parent) {
        const paragraphs = parent.querySelectorAll('p');
        return _.map(paragraphs, (obj) => obj.innerText || '');
    }

    return [];
}

/**
 * Retrieves the count of medications in each category from the section headers.
 * 
 * Parses the medication list headers to extract the number of medications
 * in each category (future, current, historic) from text like "Historiska (6)".
 * 
 * @returns An object containing the count for each medication category
 * @returns {number} .future - Count of future (framtida) medications
 * @returns {number} .current - Count of current (aktuella) medications
 * @returns {number} .historic - Count of historic (historiska) medications
 * 
 * @example
 * const counts = _getHeadersCount();
 * // { future: 2, current: 11, historic: 6 }
 */
function _getHeadersCount() {
    const MedicationHeaders = {
        FRAMTIDA: 'Framtida',
        AKTUELLA: 'Aktuella',
        HISTORISKA: 'Historiska'
    };

    const html = _getHtml();
    const allHeaderElements = html.querySelectorAll('[as-element="drug-list-section-header"]');

    return _.reduce(allHeaderElements, (acc, element) => {
        const header = _.trim(element['attrs']['section-header']);
        const count = _extractCount(element['innerText']);

        switch (header) {
            case MedicationHeaders.FRAMTIDA:
                acc.future = count;
                break;
            case MedicationHeaders.AKTUELLA:
                acc.current = count;
                break;
            case MedicationHeaders.HISTORISKA:
                acc.historic = count;
                break;
        }

        return acc;
    }, { future: 0, current: 0, historic: 0 });
}

function _extractCount(text) {
    const match = text?.match(/\((\d+)\)/);
    return match ? parseInt(match[1], 10) : 0;
}

/**
 * Retrieves and categorizes all medication rows from the DOM.
 * 
 * Uses the header counts to slice the medication rows into their respective
 * categories. The rows are expected to appear in order: future, current, historic.
 * 
 * @returns An object containing arrays of medication row elements for each category
 * @returns {Element[]} .future - Future (framtida) medication rows
 * @returns {Element[]} .current - Current (aktuella) medication rows
 * @returns {Element[]} .historic - Historic (historiska) medication rows
 * 
 * @remarks
 * This function relies on the medications being displayed in a specific order
 * in the DOM (future → current → historic) - however i've not seen it otherwise, but should be kept in mind.
 */
function _getMedicationDrugRowsCategorized() {
    const html = _getHtml()
    const headersCount = _getHeadersCount();
    const allMedications = html.querySelectorAll('[as-element="drug-row-group"]');

    return {
        future: _.slice(allMedications, 0, headersCount.future),
        current: _.slice(allMedications, headersCount.future, headersCount.future + headersCount.current),
        historic: _.slice(allMedications, headersCount.future + headersCount.current)
    };
}


/**
 * Retrieves all historic medications that have an end date matching today's date.
 * 
 * Filters through in ONLY historic medication rows and extracts relevant medication details
 * for those ending today.
 * 
 * @returns {Array<Object>} Array of medication objects ending today
 * 
 * @example
 * const endingToday = getMedicationsEndingToday();
 * // [{ product: "Aerius", strength: "5 mg", form: "Filmdragerad tablett", ... }]
 */
exports.getMedicationsEndingToday = function () {
    Log.info(logTag, "Info: getMedicationsEndingToday");
    const { historic } = _getMedicationDrugRowsCategorized();
    return _.reduce(historic, ((acc, selector) => {
        const productSelector = selector.querySelectorAll('td.tradename div:nth-child(2)')[0];
        const strengthSelector = selector.querySelectorAll('td:nth-child(6)')[0];
        const formSelector = selector.querySelectorAll('td:nth-child(7)')[0];
        const dosageSelector = selector.querySelectorAll('td:nth-child(8) .dosageStructureWrap')[0];
        const reasonForCancellationSelector = selector.querySelectorAll('td:nth-child(9)')[0];
        const insertionSelector = selector.querySelectorAll('td:nth-child(10)')[0];
        const endDateSelector = selector.querySelectorAll('td:nth-child(11)')[0];

        const product = productSelector?.innerText ?? '';
        const strength = strengthSelector?.innerText ?? '';
        const form = formSelector?.innerText ?? '';
        const dosage = dosageSelector && dosageSelector['attrs'] ? dosageSelector['attrs']['data-popover'] : '';
        const reasonForCancellation = reasonForCancellationSelector?.innerText ?? '';
        const insertion = insertionSelector?.innerText ?? '';
        const endDate = endDateSelector?.innerText ?? '';
        const guid = Guid.get();

        if (!endDate) return acc;

        const end = new Date(endDate);
        const today = new Date();

        if (end.toDateString() === today.toDateString()) {
            acc.push({
                product,
                strength,
                form,
                dosage,
                reasonForCancellation,
                insertion,
                endDate,
                guid,
            })
        }
        return acc;
    }), []);
}

//==== Functions that sorts and filter data ====

// *** Find Cosmic data from each of the deleted prescriptions in the original data and retuns an array with this Cosmic data ***
// Get ATC code and other data on deleted Pascal prescriptions
// deletedArrayLimited: does not have all data due to performance optimization in reading
// originalData with all data from full read of Pascal
// exports.getOriginalCosmicData = function (deletedArrayLimited, originalData) {
//   Log.info(logTag, "Info: getOriginalCosmicData");
//   if (!deletedArrayLimited) {
//     Log.info(logTag, "Info: empty deletedArrayLimited");
//     return [];
//   }
//   var updatedArray = [];
//   // Run through all deleted prescription
//   for (var i = 0; i < deletedArrayLimited.length; i++) {
//     // Look for this deleted prescription in the original array of prescriptions
//     _.forIn(originalData, function (value, key) {
//       if (value.pascal) {
//         for (var j = 0; j < value.pascal.length; j++) {
//           if (
//             value.pascal[j]["product"] == deletedArrayLimited[i]["product"] &&
//             value.pascal[j]["strength"] == deletedArrayLimited[i]["strength"] &&
//             value.pascal[j]["form"] == deletedArrayLimited[i]["form"]
//           ) {
//             if (value.cosmic && value.cosmic[j]) { // The prescription in Pascal might not have been (be) in Cosmic
//               updatedArray.push(_.assign(deletedArrayLimited[i], value.cosmic[j]));
//             }
//           }
//         }
//       }
//     })
//   }
//   return updatedArray;
// }

exports.getOriginalCosmicData = function (deletedPascalData, originalData) {
    Log.info(logTag, "Info: getOriginalCosmicData");

    // Look for this deleted prescription in the original array of prescriptions
    _.forIn(originalData, function (value, key) {
        if (value.pascal) {
            for (var j = 0; j < value.pascal.length; j++) {
                if (
                    value.pascal[j]["product"] == deletedPascalData["product"] &&
                    value.pascal[j]["strength"] == deletedPascalData["strength"] &&
                    value.pascal[j]["form"] == deletedPascalData["form"]
                ) {
                    return value.cosmic[j];
                }
            }
        }
    })
}


// Pausad and Ej utbytbar has those texts in front of the product name. Remove them before comparison
function clearProduct(prod) {
    return prod.replace("Får ej bytas: ", "").replace("Pausad: ", "");
}

// Find the full Pascal data from the stored data for each of the ended Medications
// Return an object with ATC properties and a match for each ATC
// Either there is a full match which is indicated with the fullMatch property
// Or there is no or more than one that match the partial data in endedMedication
// Then there is no fullMatch property in the returned prescription
exports.findCompletePascalData = function (endedMedications, originalPascalData, pid) {
    // Validate that the original data is for this patient
    if (Crypto.hash(pid, { algorithm: "MD5", hex: true }) != originalPascalData.hashPid) {
        throw "Patienten har bytts medan jämförelsen pågår. Jämförelsen avbryts."
    }
    // if (FL) Dialog.info("", JSON.stringify(endedMedications, null, 2))
    // if (FL) Dialog.info("", JSON.stringify(originalPascalData, null, 2))

    var matchPascalData = {};
    for (var i = 0; i < endedMedications.length; i++) {

        // Run through each ATC code and the prescription(s) under that ATC code
        _.forIn(originalPascalData, function (valueArray, atc) {
            if (atc != "hashPid") { // Discard the hashed pid property

                // Run through entries for this ATC code
                var fullMatch = false;
                var multipleFullMatch = false;
                var productFound = false;
                var prescriptionEntry;
                _.forEach(valueArray, function (prescription) {
                    // When the product name is found then create the ATC code in the result data
                    if (!productFound && clearProduct(prescription.product) == clearProduct(endedMedications[i].product)) {
                        productFound = true;
                        // Initially set the entry to the reduced Pascal info
                        prescriptionEntry = endedMedications[i];
                        prescriptionEntry.atc = atc;
                        prescriptionEntry.kortnotation = "";
                        prescriptionEntry.exposure = "";
                        prescriptionEntry.fullMatch = false;
                    }
                    // Check for full match and replace initial entry with full Pascal info
                    if (clearProduct(prescription.product) == clearProduct(endedMedications[i].product) &&
                        prescription.strength == endedMedications[i].strength &&
                        prescription.form == endedMedications[i].form &&
                        prescription.dosage == endedMedications[i].dosage) {
                        if (!fullMatch) { // If not already another fullMatch
                            fullMatch = true;
                            prescriptionEntry = prescription;
                            prescriptionEntry.atc = atc;
                            prescriptionEntry.reasonForCancellation = endedMedications[i]["reasonForCancellation"];
                            prescriptionEntry.fullMatch = true;
                            // Dialog.info("prescription", JSON.stringify(prescriptionEntry))
                        } else {
                            // More than one has full matched, so no unique fullMatch
                            multipleFullMatch = false;
                            Log.info(logTag, "logError: more than one fullMatch");
                            // TODO Should maybe be activated, so more than one fullMatch force user to select
                            // which ordination in Cosmic to be deleted.
                            // There should never be more than one fullMatch so currently disabled
                        }
                    }
                })
                // Update matchPascalData if product was found
                if (productFound) {
                    // if (fullMatch && multipleFullMatch) {
                    //   prescriptionEntry.fullMatch = false; // If one fullMatch then true, else false
                    // }

                    if (!matchPascalData[atc]) {
                        matchPascalData[atc] = [];
                    }
                    matchPascalData[atc].push(prescriptionEntry); // Push data to result array
                }

            }
        }) // End this ATC
    }
    Log.info(logTag, "findCompletePascalData: " + JSON.stringify(matchPascalData));
    return matchPascalData;
}

// Input: array with prescriptions
// Output: Object with atc properties and array of prescriptions within each atc
exports.createAtcObject = function (data) {
    var atcObject = {};
    _.forEach(data, function (p) {
        if (!atcObject[p.atc]) {
            atcObject[p.atc] = [];
        }
        atcObject[p.atc].push(p);
    });
    // if (FL) Dialog.info("atcObject", JSON.stringify(atcObject, null, 2));
    return atcObject;
}

exports.createAtcFormObject = function (data) {
    var atcObject = {};
    _.forEach(data, function (p) {
        let atcForm = p.atc + " + " + p.form
        if (!atcObject[atcForm]) {
            atcObject[atcForm] = [];
        }
        atcObject[atcForm].push(p);
    });
    // if (FL) Dialog.info("atcObject", JSON.stringify(atcObject, null, 2));
    return atcObject;
}

// Make cosmicData object with endastCosmic entries only (meaning there are more Cosmic entries than Pascal entries, so something to delete)
// And only Cosmic entries with ATC that is also in deletedPascalData
exports.createCosmicEndastData = function (pairedData, deletedPascalData) {
    var cosmicOnlyData = {}
    if (logData) Log.info(logTag, "createCosmicEndastData pairedData\n\n" + JSON.stringify(pairedData))
    if (logData) Log.info(logTag, "createCosmicEndastData deletedPascalData\n\n" + JSON.stringify(deletedPascalData))
    _.forIn(pairedData, function (value, key) {
        // If there is cosmic only data
        if (value["cosmicRest"].length > 0) {
            // If this Cosmic ATC is also in the deleted Pascal data
            if (deletedPascalData[key]) {
                cosmicOnlyData[key] = value["cosmicRest"];
            }
        }
    });
    if (logData) Log.info(logTag, "cosmicEndastData: " + JSON.stringify(cosmicOnlyData));
    return cosmicOnlyData;
}

exports.findCosmicDataToDelete = function (pairedDeleteData) {
    var deleteResult = [];
    _.forIn(pairedDeleteData, function (allAtcData, atc) {
        _.forEach(allAtcData["completeMatches"], function (completeEntry) {
            //if (FL) Dialog.info('completeEntry["pascal"]', JSON.stringify(completeEntry["pascal"]))
            completeEntry["cosmic"].reasonForCancellation = completeEntry["pascal"]["reasonForCancellation"]
            deleteResult.push(completeEntry["cosmic"]);
        });
        _.forEach(allAtcData["pairs"], function (pairsEntry) {
            pairsEntry["cosmic"].reasonForCancellation = pairsEntry["pascal"]["reasonForCancellation"]
            pairsEntry["cosmic"]["notFullMatch"] = true;
            deleteResult.push(pairsEntry["cosmic"]);
        });
    });
    return deleteResult;
}

function normText(str) {
    if (!str) {
        return "";
    }
    return typeof str == "object" ? str["text"] : str;
}
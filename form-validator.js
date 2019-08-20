'use strict'

// preset validation types
const builtin = {
    'not-empty': function (val) {
        return val.length > 0
    },
    'number': function (val) {
        return RegExp(/^[0-9]$/g).test(val)
    },
    'decimal': function (val) {
        return RegExp(/^[0-9]\.[0-9]$/g).test(val)
    },
    'text': function (val) {
        return true
    },
    'phone': function (val) {
        return RegExp(/^[\+]?[(]?[0-9]{3}[)]?[-\s\.]?[0-9]{3}[-\s\.]?[0-9]{4,6}$/g).test(val)
    },
    'email': function (val) {
        return RegExp(/^[^@]+@.+\..+$/g).test(val)
    },
}

class Core {
    constructor(formId, config={}) {
        this.form = document.getElementById(formId)

        // selects all form elements that have validation
        this.formElements = {
            all: this.form.querySelectorAll('*'),
            validates: this.form.querySelectorAll('[data-validate]'),
            submits: this.form.querySelectorAll('[data-submit]'),
            specialBehavior: this.form.querySelectorAll('[data-validate-behavior]')
        }

        // don't really need this anymore...
        // this.csrfToken = Core._extractHiddenInput(this.form,'CRAFT_CSRF_TOKEN')

        this.redirect = Core._extractHiddenInput(this.form,'redirect')
        this.action = this.form.action ? this.form.action.value : Core._extractHiddenInput(this.form,'action')

        this.properties = {
            // implementation-specific extended functionality
            validators: {},
            hooks: {},

            validationBehavior: ['change','focusout'],
            validClasses: [],
            invalidClasses: ['invalid']
        }

        this.init(config)
    }

    /**
     * Ensures all header keys are lower-case to prevent duplicate keys
     *
     * @param headers
     * @returns {{}}
     * @private
     */
    static _normalizeHeaders(headers) {
        let newHeaders = {}
        Object.keys(headers).forEach(h => newHeaders[h.toLowerCase()] = headers[h])
        return newHeaders
    }

    /**
     * Serializes form data for submission
     *
     * @param form
     * @param associative
     * @private
     */
    static _serializeForm(form, associative=false) {
        let serialized = []
        let assoc = {}
        const children = form.querySelectorAll('*')
        Object.keys(children).forEach((k) => {
            const field = children[k]
            const encodedFieldName = encodeURIComponent(field.name)
            if (!(!field.name || field.disabled || field.type === 'file' || field.type === 'reset' || field.type === 'submit' || field.type === 'button')) {
                // If a multi-select, get all selections
                if (field.type === 'select-multiple') {
                    for (let n = 0; n < field.options.length; n++) {
                        if (field.options[n].selected) {
                            const encodedFieldValue = encodeURIComponent(field.options[n].value)
                            assoc[encodedFieldName] = encodedFieldValue
                            serialized.push(encodedFieldName + '=' + encodedFieldValue);
                        }
                    }
                }

                // Convert field data to a query string
                else if ((field.type !== 'checkbox' && field.type !== 'radio') || field.checked) {
                    const encodedFieldValue = encodeURIComponent(field.value)
                    assoc[encodedFieldName] = encodedFieldValue
                    serialized.push(encodedFieldName + '=' + encodedFieldValue);
                }
            }
        })

        if (associative) {
            return assoc
        }
        return serialized.join('&')
    }

    /**
     * Sends a post request with the parameters given
     *
     * @param url
     * @param data
     * @param hooks
     * @param headers
     * @private
     */
    static _post(url, data, hooks={}, headers={}) {
        const xhr = new XMLHttpRequest()

        if (headers === null || Object.keys(headers).length === 0) {
            headers={'content-type':'application/x-www-form-urlencoded'}
        }

        // make sure all headers are lowercase so that we don't have duplicates
        headers = Core._normalizeHeaders(headers)

        // setup POST request for the given URL
        xhr.open('POST', url)

        // set all request headers
        Object.keys(headers).forEach(h => {
            xhr.setRequestHeader(h, headers[h])
        })

        // add event hooks for response states
        xhr.onload = () => {
            if (xhr.status === 200 && 'success' in hooks) {
                hooks['success']()
            }
            else if (xhr.status !== 200 && 'error' in hooks) {
                hooks['error']()
            }
            if ('complete' in hooks) {
                hooks['complete']()
            }
        }

        // send data with before/after event hooks
        if ('beforeSend' in hooks) {
            hooks['beforeSend']()
        }
        xhr.send(data)
        if ('afterSend' in hooks) {
            hooks['afterSend']()
        }
    }

    /**
     * Extracts the value from the first hidden input field with the given name
     *
     * @param form
     * @param inputName
     * @returns {null}
     * @private
     */
    static _extractHiddenInput(form, inputName) {
        const formElements = form.querySelectorAll('input[name='+inputName+']')
        if (formElements.length > 0) {
            return formElements[0].value
        } else {
            return null
        }
    }

    /**
     * Binds validation and submission event handlers
     * @private
     */
    _bindEventListeners() {
        const validationHandler = e => {
            const el = e.target
            this._cascadingValidate(el, (isValid, element) => {
                this._updateElement(element, isValid)
            })
        }

        // add event listeners for all configured validation behaviors
        this.properties.validationBehavior.forEach(behavior => {
            Object.keys(this.formElements.validates).forEach(k =>
                this.formElements.validates[k].addEventListener(behavior, validationHandler)
            )
        })

        // add event listeners for special validation behaviors
        Object.keys(this.formElements.specialBehavior).forEach(k => {
            const el = this.formElements.specialBehavior[k]
            el.addEventListener(el.getAttribute('data-validate-behavior'), validationHandler)
        })

        // add event listeners for submission event sources
        Object.keys(this.formElements.submits).forEach(k =>
            this.formElements.submits[k].addEventListener('click', e => {
                this.submit()
                e.preventDefault()
            })
        )
    }

    /**
     * Toggles enable/disable for all form elements or sets to specific value based on parameter
     * @param enabled
     * @private
     */
    _toggleEnabled(enabled=null) {
        const all = this.formElements.all
        const allKeys = Object.keys(all)
        if (enabled) {
            allKeys.forEach(k => all[k].disabled = false)
        } else if (enabled) {
            allKeys.forEach(k => all[k].disabled = true)
        } else {
            allKeys.forEach(k => all[k].disabled = !all[k].disabled)
        }
    }

    /**
     * Updates the classes for a given element based on validation state
     *
     * @param el
     * @param isValid
     * @returns {boolean}
     * @private
     */
    _updateElement(el, isValid=null) {
        const validClasses = this.properties.validClasses || []
        const invalidClasses = this.properties.invalidClasses || []
        if (isValid) { // valid
            validClasses.forEach(c => el.classList.add(c))
            invalidClasses.forEach(c => el.classList.remove(c))
            return true
        } else if (isValid === false) { // invalid
            validClasses.forEach(c => el.classList.remove(c))
            invalidClasses.forEach(c => el.classList.add(c))
            return false
        } else { // not validated
            validClasses.forEach(c => el.classList.remove(c))
            invalidClasses.forEach(c => el.classList.remove(c))
            return true
        }
    }

    /**
     * Validates a given element using the supplied validators. Validation is only performed if the element
     * requires validation and should validate
     *
     * @param el
     * @param callback
     * @returns {*}
     * @private
     */
    _validateElement(el, callback=null) {
        const validators = el.getAttribute('data-validate').split(' ')

        // determine if this element should validate
        const dependsOn = el.getAttribute('data-depends-on')
        const dependsValue = el.getAttribute('data-depends-value')
        const dependsOnChecked = el.getAttribute('data-depends-on-checked')
        let shouldValidate = true
        if (dependsOnChecked) {
            const d = document.getElementById(dependsOnChecked)
            shouldValidate = !d.disabled && d.checked
        } else if (dependsOn && dependsValue) {
            const d = document.getElementById(dependsOn)
            shouldValidate = !d.disabled && d.value === dependsValue
        } else if (dependsOn) {
            const d = document.getElementById(dependsOn)
            shouldValidate = !d.disabled
        }

        // validate using all listed validators (non-builtin validators are described in the config)
        let valid = null
        if (shouldValidate) {
            valid = true
            validators.forEach(v => {
                if (v in builtin) {
                    valid = valid && builtin[v](el.value)
                } else if (v in this.properties.validators) {
                    valid = valid && this.properties.validators[v](el.value)
                } else {
                    console.log('invalid validator: `' + v + '`')
                }
            })
        }

        if (callback) {
            callback(valid, el)
        }

        return valid
    }

    _cascadingValidate(el, cb=null) {
        let queue = [el]
        let visited = {}
        while (queue.length > 0) {
            // get next element from queue, make sure we don't revisit any nodes
            const currentElement = queue.shift()
            const currentKey = currentElement.id || currentElement.name
            visited[currentKey] = currentElement
            console.log('validating '+currentElement.id)

            // gather all dependent nodes and add them to the queue, unless they were already visited
            const dependentElements = document.querySelectorAll('[data-depends-on='+currentElement.id+']')
            Object.keys(dependentElements).forEach((k) => {
                const key = dependentElements[k].id || dependentElements[k].name
                if (key in visited) {
                    return
                }
                queue.push(dependentElements[k])
            })

            // validate this element with callback
            this._validateElement(currentElement, cb)
        }
    }

    /**
     * Validates all fields of the form
     * @returns {boolean}
     */
    validate() {
        let valid = true
        Object.keys(this.formElements.validates).forEach(k => {
            const el = this.formElements.validates[k]
            const current = this._updateElement(el, this._validateElement(el))
            valid = valid && current
        })
        return valid
    }

    /**
     * Validates and then submits the form
     */
    submit(asJson=true) {
        const headers = asJson ? {'content-type':'application/json'} : {}
        const data = Core._serializeForm(this.form, asJson)
        if (this.validate()) {
            console.log('form valid, submitting...')
            Core._post(this.action, asJson ? JSON.stringify(data) : data, {
                'beforeSend': (e) => {
                    this._toggleEnabled(false)
                },
                'success': (e) => {
                    console.log('submitted form successfully')
                    if ('afterSubmit' in this.properties.hooks) {
                        this.properties.hooks.afterSubmit(e)
                    }
                },
                'error': (e) => {
                    console.log('error submitting form')
                    if ('submitError' in this.properties.hooks) {
                        this.properties.hooks.submitError(e)
                    }
                },
                'complete': (e) => {
                    this._toggleEnabled(true)
                }
            }, headers)
        } else {
            console.log('form not valid')
            this._toggleEnabled(true)
        }
    }


    /**
     * Sets settings upon module instantiation AND allows settings to be changed
     * after instantiation.
     * @type {fBound|any}
     */
    defineSettings = (settings) => {
        Object.assign(this.properties, settings)
        return this.properties
    }

    /**
     * Returns settings
     * @returns {{validators: {}, hooks: {}, validationBehavior: string, validClasses: Array, invalidClasses: string[]}|{}}
     */
    getSettings = () => {
        return this.properties
    }

    init = (settings) => {
        // Settings
        this.defineSettings(settings)

        //TODO: add honeypot field if enabled in settings

        this._bindEventListeners()
    }
}

export default function init(formId, settings={}) {
    const domReady = function (callback) {
        document.readyState === 'interactive' || document.readyState === 'complete' ? callback() : document.addEventListener('DOMContentLoaded', callback)
    }

    domReady(() => {
        window.formValidator = new Core(formId, settings)
    })
}
import form from './form-validator'

console.log('initializing form validator')
form('form-1', {
    validators: {
        custom() {
            console.log('using custom validator!')
            return true
        }
    },
    hooks: {
        afterSubmit() {
            console.log('custom event hook!')
        }
    },
    validClasses: ['valid']
})

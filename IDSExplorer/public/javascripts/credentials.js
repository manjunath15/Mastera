var isFormSubmitted = false;

(function() {

    $(document).ready(function() {
        var options = {
            dataType: 'json',
            beforeSubmit:  showRequest,  // pre-submit callback
            success:       showResponse  // post-submit callback
        };

        $('#credential').ajaxForm(options);
    });

    function showRequest(formData, jqForm, options) {
        var formObj = $('form');
        $(document.createElement('img'))
            .attr('src','/images/loader.gif')
            .attr('id','oauth_loader')
            .addClass('loader')
            .attr('style', 'padding-left:10px;')
            .insertBefore($('span#preloader_span'));
        try {
            $('div.error', formObj).remove();
        } catch(e) {}
        return;
    }

    function showResponse(data)  {
        isFormSubmitted = false;
        $('#oauth_loader', 'form').remove();
        if (data.signin) {
            window.location = data.signin;
        } else if(data.status && data.status == 'success') {
            window.parent.opener.location.reload();
            window.close();
        } else if(data.err) {
            var errMsg = data.err;
            if(data.text)
                errMsg += " Cause: " + data.text;
            var formObj = $('form');
            formObj.append($(document.createElement('div')).attr('class', 'error').text(errMsg));
        }
    }

    $('#popup-cancel').click(function(){
        window.close();
    })

    $('#i_have_access_tokens_id').click(function() {
        $('#div_access_key_id').addClass('show');
        $('#i_have_access_tokens_id').addClass('hide');
        $('#C2QB_id', 'form').remove();
        try {
            $('div.error', 'form').remove();
        } catch(e) {}
        $(document.createElement('input'))
            .attr('type','button')
            .attr('name','submit_name')
            .addClass('btn btn_bold')
            .attr('value', 'Submit')
            .attr('onclick', 'submitForm()')
            .insertBefore($('span#preloader_span'));
    });

})();

function submitForm() {
    if(!isFormSubmitted) {
        isFormSubmitted = true;
        $('#submit_btn_id').trigger('click');
    }
}
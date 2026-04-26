"use strict";

// contentFields: Object of placeholders e.g. {headline_1: 'Buy now', background_image_1: '', ...}
function replaceContent(contentFields) {

    var url = "";
    var elements = [];
    var value = "";
    var placeholder = "";
    var selector = "";
    var placeholders = Object.keys(contentFields);

    // Save creative dimensions
    document.creativeWidth = document.body.innerWidth;
    document.creativeHeight = document.body.innerHeight;

    var log = {
        success: {}, 
        error: {}, 
        warning: {}
    };

    console.log('✅ ' + 'Dynamic Content loaded from feed: ', contentFields); 


    // Check for default creative
    if ((new RegExp('default', 'ig')).test(contentFields['advert_id'])) {
        console.log('😡 ‼️', 'This is the default creative');
    }

    // Each in placeholders
    console.log('Placeholders', placeholders);

    for (var i in placeholders) {
        placeholder = placeholders[i].toLowerCase();
        value = contentFields[placeholder]; 

        if (placeholder.indexOf('$') !== -1) {
            log.warning[placeholder] = "😡 Placeholder name cannot contains $ signs";
            continue;
        }

        // Import css file to head
        if (new RegExp('(_css)|(css_)').test(placeholder)) {
            var link = document.createElement("link");
            link.href = value;
            link.type = "text/css";
            link.rel = "stylesheet";
            document.getElementsByTagName("head")[0].appendChild(link);
            log.success[placeholder] = "✅ " + "CSS file added to head: " + value;
            continue;
        }

        // Import javascript code to head
        if (new RegExp('(_script)|(script_)').test(placeholder)) {
            var script = document.createElement("script");
            script.innerHTML = value;
            document.getElementsByTagName("head")[0].appendChild(script);
            log.success[placeholder] = "✅ " + "Script is added to head: " + value;
            continue;
        } 


        // Get url text
        url = value;

        if (typeof value === 'object') {
            url = value.Url ? value.Url : value;
            value = value.value ? value.value : value;
            contentFields[placeholder] = value;
        }

        // Create dom query selector, and find elements for placeholders
        selector = [
            "#" + placeholder, // Find for #background_image_1
            "." + placeholder, // Find for .background_image_1
            "#" + placeholder.replace(/_/g, "-"), // Find for #background-image-1
            "." + placeholder.replace(/_/g, "-"), // Find for .background-image-1
            "[name='" + placeholder + "']", // Find for [name='background-image-1']
            "[name='" + placeholder.replace(/_/g, "-") + "']", // Find for [name='background_image_1']
            "[data-placeholder='" + placeholder + "']", // Find for [data-placeholder='background_image-1']
            "[data-placeholder='" + placeholder.replace(/_/g, "-") + "']" // Find for [data-placeholder='background-image-1']
        ].join(", ");


        elements = document.querySelectorAll(selector); 


        // If queried elements not found for placeholder
        if (!elements || !elements.length) {
            log.warning[placeholder] = "😡 " + "Elements not found for selector: " + selector;
            continue;
        } 


        // Each in DOM elements
        for (var e = 0, element; (element = elements[e]); e++) {
            try {


                // Replace images
                if (new RegExp('(_image)|(image_)').test(placeholder)) {


                    // If tag is img set src if not set background image
                    if (element.tagName.toLowerCase() === "img") {

                        log.success[placeholder] = 
                            "✅ " +
                            placeholder +
                            " image placeholder found, set src to: " +
                            url;

                        element.src = url;

                    } else {

                        log.success[placeholder] = 
                            "✅ " +
                            placeholder +
                            " image placeholder found, set background image to: " +
                            url;

                        element.style.backgroundImage = "url('" + url + "')";
                    }

                    continue;
                } 


                // Replace videos
                if (new RegExp('(_video)|(video_)').test(placeholder)) {
                    url = value.Url ? value.Url : value; // If tag is img set src if not set background image

                    if (element.tagName.toLowerCase() === "video") {

                        log.success[placeholder] = 
                            "✅ " +
                            placeholder +
                            " video placeholder found, set src to: " +
                            url;

                        element.src = url;
                    }

                    continue;
                }

                // Replace colors
                if (new RegExp('(_color)|(color_)').test(placeholder)) {

                    if (new RegExp('(_background)|(background_)').test(placeholder)) {
                        element.style.backgroundColor = value;
                        log.success[placeholder] = "✅ " + " background color placeholder found, set color to: " + value;
                    } else {
                        element.style.color = value;
                        log.success[placeholder] = "✅ " + " color placeholder found, set color to: " + value;
                    }

                    continue;
                } 

                // Replace postions
                if (new RegExp('(_position)|(position_)').test(placeholder)) {
                    log.success[placeholder] = "✅ " + " positioning placeholder found, set background position to:  " + value;
                    element.style.cssText += value;
                    continue;
                } 

                // Hide element
                if (new RegExp('(_visible)|(visible_)').test(placeholder)) {
                    log.success[placeholder] = "✅ " + " is " + value + ", " + (value ? "show" : "hide") + " elements";
                    element.style.display = value;
                    continue;
                } 

                // Set opacity
                if (new RegExp('(_opacity)|(opacity_)').test(placeholder)) {
                    log.success[placeholder] = "✅ " + " opacity placeholder found, set element opacity " + element.className;
                    element.style.opacity = value;
                    continue;
                } 


                // Append class name
                if (new RegExp('(_class)|(class_)').test(placeholder)) {
                    element.className += " " + value;
                    log.success[placeholder] = '✅ ' + ' class name append to element: ' + element.className;
                    continue;
                } 

                // Set css
                if (new RegExp('(_style)|(style_)').test(placeholder)) {
                    log.success[placeholder] = '✅ ' + 'css placeholder found add style code to element: ' + value;
                    element.style.cssText += value;
                    continue;
                } 


                // Replace text placeholders
                if (typeof value === 'string' || typeof value === 'number') {

                    log.success[placeholder] = '✅ ' + 'placeholder found, set inner text to: ' + value;

                     // Has child element show warning
                    if (element.childElementCount) {
                        log.warning[placeholder] = 'Element has ' + element.childElementCount + 'children, please check it does not remove any important elements';
                    }

                    element.innerHTML = value.toString().replace(/\n/g, '<br>');
                    continue;
                }

                log.warning[placeholder] = '😕 ' + 'placeholder not used (DOM not changed) value is (' + typeof value + '): ' + value;

            } catch (error) {

                log.error[placeholder] = '😡 ‼️ ' +
                    'Error found when replace placeholder: ' +
                    placeholder +
                    'Element: ' +
                    element +
                    'Error Message: ' +
                    error;
            }
        }
    }

    // Console log everything
    console.log(log);

    return contentFields;
}


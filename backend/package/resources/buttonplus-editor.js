(function () {
    const BP_CLICK_EVENT_SOURCES = [
        { value: 'payload', label: 'payload (device MQTT)' },
        { value: 'topic', label: 'topic' },
        { value: 'device', label: 'device' },
        { value: 'button_page', label: 'button page' },
        { value: 'button', label: 'button' },
        { value: 'event_type', label: 'event type' },
        { value: 'buttonplus', label: 'buttonplus (metadata object)' },
        { value: 'buttonplus_debug', label: 'debug info (received + mqtt sent)' }
    ];

    const BP_ACTION_OUTPUT_SOURCES = [
        { value: 'buttonplus_debug', label: 'debug info (input + mqtt sent)' }
    ];

    function bpPrepareOutputProperties(node, options) {
        const sources = options.sources || BP_CLICK_EVENT_SOURCES;
        const defaults = options.defaults || [];
        const container = $('#node-input-output-properties-container')
            .css('min-height', '120px')
            .css('min-width', '450px');

        container.editableList({
            addItem: function (containerRow, index, property) {
                const row = property || {
                    property: '',
                    propertyType: 'msg',
                    value: sources[0].value,
                    valueType: 'event'
                };

                containerRow.css({
                    overflow: 'hidden',
                    whiteSpace: 'nowrap'
                });

                const fields = $('<div/>').appendTo(containerRow);

                const propertyName = $('<input/>', {
                    class: 'node-input-output-property-name',
                    type: 'text'
                })
                    .css('width', '30%')
                    .appendTo(fields)
                    .typedInput({ types: ['msg'] });

                $('<div/>', { style: 'display:inline-block; padding:0 6px;' })
                    .text('=')
                    .appendTo(fields);

                const sourceSelect = $('<select/>', {
                    class: 'node-input-output-property-source',
                    style: 'width:calc(70% - 30px);'
                }).appendTo(fields);

                sources.forEach(function (source) {
                    sourceSelect.append(
                        $('<option></option>').val(source.value).text(source.label)
                    );
                });

                propertyName.typedInput('value', row.property || '');
                propertyName.typedInput('type', row.propertyType || 'msg');
                sourceSelect.val(row.value || sources[0].value);
            },
            removable: true,
            sortable: true
        });

        const properties = (node.outputProperties && node.outputProperties.length)
            ? node.outputProperties
            : defaults;

        properties.forEach(function (property) {
            container.editableList('addItem', property);
        });
    }

    function bpSaveOutputProperties(node) {
        const properties = [];
        $('#node-input-output-properties-container').editableList('items').each(function () {
            const row = $(this);
            properties.push({
                property: row.find('.node-input-output-property-name').typedInput('value'),
                propertyType: row.find('.node-input-output-property-name').typedInput('type'),
                value: row.find('.node-input-output-property-source').val(),
                valueType: 'event'
            });
        });
        node.outputProperties = properties;
    }

    function bpResizeOutputProperties(size) {
        const rows = $('#dialog-form>div:not(.node-input-output-properties-container-row)');
        let height = size.height;

        for (let i = 0; i < rows.length; i++) {
            height -= $(rows[i]).outerHeight(true);
        }

        const editorRow = $('#dialog-form>div.node-input-output-properties-container-row');
        height -= (parseInt(editorRow.css('marginTop'), 10) + parseInt(editorRow.css('marginBottom'), 10));

        $('#node-input-output-properties-container').editableList('height', height);
    }

    window.BP_CLICK_EVENT_SOURCES = BP_CLICK_EVENT_SOURCES;
    window.BP_ACTION_OUTPUT_SOURCES = BP_ACTION_OUTPUT_SOURCES;
    window.bpPrepareOutputProperties = bpPrepareOutputProperties;
    window.bpSaveOutputProperties = bpSaveOutputProperties;
    window.bpResizeOutputProperties = bpResizeOutputProperties;

    window.bpPrepareActionOutputProperties = function (node) {
        if ((!node.outputProperties || !node.outputProperties.length) && node.debugOutput) {
            node.outputProperties = [{
                property: 'buttonplus_debug',
                propertyType: 'msg',
                value: 'buttonplus_debug',
                valueType: 'event'
            }];
        }

        bpPrepareOutputProperties(node, {
            sources: BP_ACTION_OUTPUT_SOURCES,
            defaults: []
        });
    };
})();

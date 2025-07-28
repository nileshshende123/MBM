public without sharing class OrderController {
    // Get order record for checking cooler send //
    @AuraEnabled
    public static Boolean getOrderRecord(String orderId) {
        System.debug('orderId::'+orderId);
        try{
            Order orderRecord = [SELECT Id, OrderNumber, Cooler_Reaches__c FROM Order WHERE OrderNumber =: orderId Limit 1];
            return orderRecord.Cooler_Reaches__c;
        }
        catch(Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
        
    }
    // Update order by lwc form //
    @AuraEnabled
    public static String updateOrder(String orderNo, String outbounfTracking, String inboundTracking) {
        System.debug('orderNo => '+ orderNo);
        System.debug('outbounfTracking => '+ outbounfTracking);
        System.debug('inboundTracking => '+ inboundTracking);
        Order orderToUpdate = [SELECT Id, OrderNumber, Email__c, Cooler_Reaches__c, Machine__c, Cooler_Send_Date__c, Cooler_Back_To_Processing__c, TotalAmount, Actual_Weight_oz__c
                               FROM Order WHERE OrderNumber = :orderNo LIMIT 1];
        List<Machine__c> availableMachines = [SELECT Id, Open_to_Schedule__c, Next_Available_Date__c, Capacity_oz__c 
                                              FROM Machine__c WHERE Open_to_Schedule__c = true
                                              ORDER BY Capacity_oz__c ASC];
        List<Machine__c> machinesWithDates = [SELECT Id, Next_Available_Date__c 
                                              FROM Machine__c 
                                              WHERE Next_Available_Date__c != null 
                                              ORDER BY Next_Available_Date__c ASC 
                                              LIMIT 1];
        System.debug('orderToUpdate => '+ orderToUpdate);
        System.debug('availableMachines => '+ availableMachines);
        System.debug('machinesWithDates => '+ machinesWithDates);
        if (orderToUpdate != null) {
            // Cooler send
            if (!orderToUpdate.Cooler_Reaches__c) { 
                orderToUpdate.Cooler_Reaches__c = true;
                orderToUpdate.Cooler_Send_Date__c = System.now();
                orderToUpdate.Outbound_Tracking_Nmber__c = outbounfTracking;
                orderToUpdate.Inbound_Tracking_Number__c = inboundTracking;
                
            }
            // Cooler receive back
            else if (!orderToUpdate.Cooler_Back_To_Processing__c) { 
                // Cooler received date
                orderToUpdate.Cooler_Back_To_Processing__c = true;
                orderToUpdate.Cooler_Received_Date__c = System.now();
            }
            update orderToUpdate;
            // Create and insert Machine_Job__c
            if (orderToUpdate.Machine__c != null && !availableMachines.isEmpty()) {
                Machine_Job__c mcjob = new Machine_Job__c();
                mcjob.Order__c = orderToUpdate.Id;
                mcjob.Machine__c = orderToUpdate.Machine__c;
                mcjob.Status__c = 'Scheduled';
                mcjob.Job_Quantity_oz__c = orderToUpdate.Actual_Weight_oz__c;
                insert mcjob;
            }
        } else {
            throw new AuraHandledException('Order not found');
        }
        return 'Order updated successfully!';
    }

}
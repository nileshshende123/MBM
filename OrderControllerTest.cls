@isTest
public class OrderControllerTest {
    
    @TestSetup
    static void makeData() {
        // Get a record type for Account (if exists)
        Id accountRtId;
        List<RecordType> acctRTs = [SELECT Id FROM RecordType WHERE SObjectType = 'Account' LIMIT 1];
        if (!acctRTs.isEmpty()) {
            accountRtId = acctRTs[0].Id;
        }

        // Create a test Account
        Account testAccount = new Account(Name = 'Test Account');
        if (accountRtId != null) {
            testAccount.RecordTypeId = accountRtId;
        }
        insert testAccount;

        // Create test Order
        Order testOrder = new Order(
            AccountId = testAccount.Id,
            Email__c = 'test@example.com',
            Cooler_Reaches__c = false,
            Cooler_Back_To_Processing__c = false,
            Actual_Weight_oz__c = 50.0,
            Status = 'Draft',
            EffectiveDate = System.today(),
            Pricebook2Id = Test.getStandardPricebookId()
        );
        insert testOrder;

        // Create test Machines
        List<Machine__c> testMachines = new List<Machine__c>{
            new Machine__c(Open_to_Schedule__c = true, Next_Available_Date__c = System.today().addDays(1), Capacity_oz__c = 100.0),
            new Machine__c(Open_to_Schedule__c = true, Next_Available_Date__c = System.today().addDays(2), Capacity_oz__c = 200.0),
            new Machine__c(Open_to_Schedule__c = false, Next_Available_Date__c = System.today().addDays(3), Capacity_oz__c = 150.0)
        };
        insert testMachines;

        // Assign machine to the test order
        testOrder.Machine__c = testMachines[0].Id;
        update testOrder;
    }

    @isTest
    static void testGetOrderRecord_Success() {
        Order testOrder = [SELECT OrderNumber FROM Order LIMIT 1];
        Test.startTest();
        Boolean result = OrderController.getOrderRecord(testOrder.OrderNumber);
        Test.stopTest();
        System.assert(result != null);
        System.assertEquals(true, result);
    }

    @isTest
    static void testGetOrderRecord_OrderNotFound() {
        Test.startTest();
        Boolean result = OrderController.getOrderRecord('INVALID');
        Test.stopTest();
        System.assertEquals(false, result);
    }

    @isTest
    static void testUpdateOrder_CoolerSend() {
        Order testOrder = [SELECT Id, OrderNumber FROM Order LIMIT 1];
        Test.startTest();
        String result = OrderController.updateOrder(testOrder.OrderNumber, 'OUT123', 'IN123');
        Test.stopTest();

        Order updated = [SELECT Cooler_Reaches__c, Cooler_Send_Date__c, Outbound_Tracking_Nmber__c, Inbound_Tracking_Number__c FROM Order WHERE OrderNumber = :testOrder.OrderNumber];
        System.assertEquals(true, updated.Cooler_Reaches__c);
        System.assertNotEquals(null, updated.Cooler_Send_Date__c);
        System.assertEquals('OUT123', updated.Outbound_Tracking_Nmber__c);
        System.assertEquals('IN123', updated.Inbound_Tracking_Number__c);

        List<Machine_Job__c> jobs = [SELECT Id FROM Machine_Job__c WHERE Order__c = :testOrder.Id];
        System.assertEquals(1, jobs.size());
    }

    @isTest
    static void testUpdateOrder_CoolerReceiveBack() {
        Order testOrder = [SELECT Id, OrderNumber FROM Order LIMIT 1];
        testOrder.Cooler_Reaches__c = true;
        testOrder.Cooler_Send_Date__c = System.now().addDays(-1);
        update testOrder;

        Test.startTest();
        String result = OrderController.updateOrder(testOrder.OrderNumber, 'OUT123', 'IN123');
        Test.stopTest();

        Order updated = [SELECT Cooler_Back_To_Processing__c, Cooler_Received_Date__c FROM Order WHERE Id = :testOrder.Id];
        System.assertEquals(true, updated.Cooler_Back_To_Processing__c);
        System.assertNotEquals(null, updated.Cooler_Received_Date__c);
    }

    @isTest
    static void testUpdateOrder_OrderNotFound() {
        Test.startTest();
        try {
            OrderController.updateOrder('INVALID', 'OUT123', 'IN123');
            System.assert(false, 'Expected AuraHandledException');
        } catch (AuraHandledException e) {
            System.assert(e.getMessage().contains('Order not found'), 'Expected "Order not found" message, got: ' + e.getMessage());
        }
        Test.stopTest();
    }

    @isTest
    static void testUpdateOrder_NoAvailableMachines() {
        List<Machine__c> allMachines = [SELECT Id, Open_to_Schedule__c FROM Machine__c];
        for (Machine__c m : allMachines) {
            m.Open_to_Schedule__c = false;
        }
        update allMachines;

        Order testOrder = [SELECT Id, OrderNumber FROM Order LIMIT 1];
        Test.startTest();
        String result = OrderController.updateOrder(testOrder.OrderNumber, 'OUT456', 'IN456');
        Test.stopTest();

        List<Machine_Job__c> jobs = [SELECT Id FROM Machine_Job__c WHERE Order__c = :testOrder.Id];
        System.assertEquals(0, jobs.size());
    }

    @isTest
    static void testUpdateOrder_NoMachineAssigned() {
        Order testOrder = [SELECT Id, OrderNumber FROM Order LIMIT 1];
        testOrder.Machine__c = null;
        update testOrder;

        Test.startTest();
        String result = OrderController.updateOrder(testOrder.OrderNumber, 'OUT789', 'IN789');
        Test.stopTest();

        List<Machine_Job__c> jobs = [SELECT Id FROM Machine_Job__c WHERE Order__c = :testOrder.Id];
        System.assertEquals(0, jobs.size());
    }

    @isTest
    static void testUpdateOrder_WithNullTrackingNumbers() {
        Order testOrder = [SELECT Id, OrderNumber FROM Order LIMIT 1];

        Test.startTest();
        String result = OrderController.updateOrder(testOrder.OrderNumber, null, null);
        Test.stopTest();

        Order updated = [SELECT Cooler_Reaches__c FROM Order WHERE Id = :testOrder.Id];
        System.assertEquals(true, updated.Cooler_Reaches__c);
    }

    @isTest
    static void testUpdateOrder_BulkScenario() {
        Account acc = [SELECT Id FROM Account LIMIT 1];
        List<Order> orders = new List<Order>();
        for (Integer i = 0; i < 5; i++) {
            orders.add(new Order(
                AccountId = acc.Id,
                Email__c = 'bulk' + i + '@example.com',
                Cooler_Reaches__c = false,
                Cooler_Back_To_Processing__c = false,
                Actual_Weight_oz__c = 20.0,
                Status = 'Draft',
                EffectiveDate = System.today(),
                Pricebook2Id = Test.getStandardPricebookId()
            ));
        }
        insert orders;

        Test.startTest();
        for (Order o : orders) {
            o = [SELECT OrderNumber FROM Order WHERE Id = :o.Id];
            OrderController.updateOrder(o.OrderNumber, 'OUT' + o.OrderNumber, 'IN' + o.OrderNumber);
        }
        Test.stopTest();

        List<Order> updatedOrders = [SELECT Cooler_Reaches__c FROM Order WHERE Id IN :orders];
        for (Order o : updatedOrders) {
            System.assertEquals(true, o.Cooler_Reaches__c);
        }
    }
}